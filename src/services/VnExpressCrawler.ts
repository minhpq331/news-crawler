import axios, { AxiosInstance } from 'axios';
import xml2js from 'xml2js';
import moment from 'moment';
import { NewsCrawlerService, ProgressCallback, CrawlerResult } from '../types';

interface Article {
    id: string;
    type: number;
    title: string;
    url: string;
    totalLikes: number;
    totalComments: number;
}

interface ArticleBasicResponse {
    code: number;
    data: {
        article_id: string;
        article_type: number;
        title: string;
        share_url: string;
    }[];
}

interface CommentResponse {
    error: number;
    data: {
        items: {
            userlike: number;
        }[];
    };
}

export class VnExpressCrawler implements NewsCrawlerService {
    private readonly httpClient: AxiosInstance;

    constructor(httpClient?: AxiosInstance) {
        this.httpClient = httpClient || axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Referer': 'https://vnexpress.net/',
                'Origin': 'https://vnexpress.net'
            }
        });
    }

    async crawl(days: number, onProgress: ProgressCallback): Promise<CrawlerResult[]> {

        const dates = Array.from({ length: days }, (_, i) => moment().subtract(i + 1, 'days'));
        onProgress(5, 'Fetching article URLs from sitemaps...');

        // Fetch all URLs from sitemaps
        const allUrls = await Promise.all(dates.map(date => this.fetchSitemapUrls(date)));
        const urls = allUrls.flat();
        onProgress(15, 'Extracting article IDs...');

        // Extract article IDs
        const articleIds = this.extractArticleIds(urls);
        onProgress(20, 'Fetching article details...');

        // Fetch article details
        const articles = await this.fetchArticleDetails(articleIds, onProgress);
        onProgress(50, 'Fetching comment likes...');

        // Fetch comment likes for each article in parallel, 10 at a time
        const totalBatches = Math.ceil(articles.length / 10);
        let completedBatches = 0;

        for (let i = 0; i < articles.length; i += 10) {
            const batch = articles.slice(i, i + 10);
            const results = await Promise.all(
                batch.map(article => this.fetchCommentLikes(article))
            );
            batch.forEach((article, index) => {
                article.totalLikes = results[index].likes;
                article.totalComments = results[index].comments;
            });

            completedBatches++;
            const progress = 50 + Math.floor((completedBatches / totalBatches) * 45);
            onProgress(progress, `Processing articles ${i + 1}-${Math.min(i + 10, articles.length)}...`);
        }

        // Sort and get top 10 articles by total likes
        const topArticles = articles
            .sort((a, b) => b.totalLikes - a.totalLikes)
            .slice(0, 10);

        onProgress(100, 'Done!');

        // Return results in CrawlerResult format
        return topArticles.map(article => ({
            title: article.title,
            url: article.url,
            reactions: article.totalLikes,
            comments: article.totalComments
        }));
    }

    // Make other functions private instance methods
    private async fetchSitemapUrls(date: moment.Moment): Promise<string[]> {
        try {
            const sitemapUrl = `https://vnexpress.net/articles-${date.format('YYYY')}-sitemap.xml?m=${date.format('M')}&d=${date.format('D')}`;
            const response = await this.httpClient.get(sitemapUrl);
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(response.data);
            return result.urlset.url.map((url: any) => url.loc[0]);
        } catch (error) {
            console.error('Error fetching sitemap URLs:', error);
            return [];
        }
    }

    // ... other methods ...
    private extractArticleIds(urls: string[]): string[] {
        return urls.map(url => {
            const match = url.match(/(\d+)\.html$/);
            return match ? match[1] : '';
        }).filter(id => id !== '');
    }

    private async fetchArticleDetails(articleIds: string[], onProgress: ProgressCallback): Promise<Article[]> {
        try {
            const batchSize = 100;
            const articles: Article[] = [];
            const totalBatches = Math.ceil(articleIds.length / batchSize);
            let completedBatches = 0;
            for (let i = 0; i < articleIds.length; i += batchSize) {
                const batch = articleIds.slice(i, i + batchSize);
                try {
                    const response = await this.httpClient.get<ArticleBasicResponse>('https://gw.vnexpress.net/ar/get_basic', {
                        params: {
                            article_id: batch.join(','),
                            data_select: 'title,share_url,article_type,publish_time'
                        },
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                            'Referer': 'https://vnexpress.net/',
                            'Origin': 'https://vnexpress.net'
                        }
                    });
                    const batchArticles = response.data.data.map(item => ({
                        id: item.article_id,
                        type: item.article_type,
                        title: item.title,
                        url: item.share_url,
                        totalLikes: 0,
                        totalComments: 0
                    }));
                    articles.push(...batchArticles);
                    completedBatches++;
                    const progress = 20 + Math.floor((completedBatches / totalBatches) * 30);
                    onProgress(progress, `Processing articles ${i + 1}-${Math.min(i + batchSize, articleIds.length)}...`);
                } catch (error) {
                    console.error('Error fetching article details:', error);
                }
            }

            return articles;
        } catch (error) {
            console.error('Error fetching article details:', error);
            return [];
        }
    }

    private async fetchCommentLikes(article: Article): Promise<{ likes: number, comments: number }> {
        try {
            let totalLikes = 0;
            let totalComments = 0;
            let offset = 0;
            const limit = 100;
            const maxRounds = 20;
            let currentRound = 0;

            while (currentRound < maxRounds) {
                const response = await this.httpClient.get<CommentResponse>('https://usi-saas.vnexpress.net/index/get', {
                    params: {
                        offset: offset,
                        limit: limit,
                        frommobile: 0,
                        sort_by: 'like',
                        is_onload: 1,
                        objectid: article.id,
                        objecttype: article.type,
                        siteid: 1000000
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                        'Referer': 'https://vnexpress.net/',
                        'Origin': 'https://vnexpress.net'
                    }
                });

                const comments = response.data.data.items;
                totalComments += comments.length;
                totalLikes += comments.reduce((sum, comment) => sum + comment.userlike, 0);

                if (comments.length < limit) {
                    break;
                }

                offset += limit;
                currentRound++;
            }

            return { likes: totalLikes, comments: totalComments };
        } catch (error) {
            console.error(`Error fetching comments for article ${article.id}:`, error);
            return { likes: 0, comments: 0 };
        }
    }
} 