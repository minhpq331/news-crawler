import axios from 'axios';
import xml2js from 'xml2js';
import moment from 'moment';
import { ProgressCallback, CrawlerResult } from './crawler';

export async function crawlVnExpress(onProgress: ProgressCallback): Promise<CrawlerResult[]> {
    // Get last 7 days (don't include today)
    const dates = Array.from({length: 7}, (_, i) => moment().subtract(i + 1, 'days'));
    onProgress(5, 'Fetching article URLs from sitemaps...');
    
    // Fetch all URLs from sitemaps
    const allUrls = await Promise.all(dates.map(date => fetchSitemapUrls(date)));
    const urls = allUrls.flat();
    onProgress(15, 'Extracting article IDs...');
    
    // Extract article IDs
    const articleIds = extractArticleIds(urls);
    onProgress(25, 'Fetching article details...');
    
    // Fetch article details
    const articles = await fetchArticleDetails(articleIds);
    onProgress(50, 'Fetching comment likes...');
    
    // Fetch comment likes for each article in parallel, 10 at a time
    const totalBatches = Math.ceil(articles.length / 10);
    let completedBatches = 0;
    
    for (let i = 0; i < articles.length; i += 10) {
        const batch = articles.slice(i, i + 10);
        const results = await Promise.all(
            batch.map(article => fetchCommentLikes(article))
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

async function fetchSitemapUrls(date: moment.Moment): Promise<string[]> {
    const url = `https://vnexpress.net/articles-${date.format('YYYY')}-sitemap.xml?m=${date.format('M')}&d=${date.format('D')}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
            }
        });
        const result = await xml2js.parseStringPromise(response.data);
        return result.urlset.url.map((item: any) => item.loc[0]);
    } catch (error) {
        console.error(`Error fetching sitemap for ${date.format('YYYY-MM-DD')}:`, error);
        return [];
    }
}

function extractArticleIds(urls: string[]): string[] {
    return urls.map(url => {
        const match = url.match(/(\d+)\.html$/);
        return match ? match[1] : '';
    }).filter(id => id !== '');
}

async function fetchArticleDetails(articleIds: string[]): Promise<Article[]> {
    const batchSize = 100;
    const articles: Article[] = [];

    for (let i = 0; i < articleIds.length; i += batchSize) {
        const batch = articleIds.slice(i, i + batchSize);
        try {
            const response = await axios.get<ArticleBasicResponse>('https://gw.vnexpress.net/ar/get_basic', {
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
        } catch (error) {
            console.error('Error fetching article details:', error);
        }
    }

    return articles;
}

async function fetchCommentLikes(article: Article): Promise<{likes: number, comments: number}> {
    try {
        let totalLikes = 0;
        let totalComments = 0;
        let offset = 0;
        const limit = 100;
        const maxRounds = 20;
        let currentRound = 0;

        while (currentRound < maxRounds) {
            const response = await axios.get<CommentResponse>('https://usi-saas.vnexpress.net/index/get', {
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