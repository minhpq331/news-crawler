import axios, { AxiosInstance } from 'axios';
import xml2js from 'xml2js';
import moment from 'moment';
import { NewsCrawlerService, ProgressCallback, CrawlerResult } from '../types';
import { AppDataSource } from '../config/database';
import { CachedSitemap } from '../entities/CachedSitemap';
import { CachedArticle } from '../entities/CachedArticle';
import { In } from "typeorm";

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
    private sitemapRepo = AppDataSource.getRepository(CachedSitemap);
    private articleRepo = AppDataSource.getRepository(CachedArticle);

    constructor(httpClient?: AxiosInstance) {
        this.httpClient =
            httpClient ||
            axios.create({
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                    Referer: 'https://vnexpress.net/',
                    Origin: 'https://vnexpress.net',
                },
            });
    }

    private async getCachedOrFetchSitemap(
        date: moment.Moment
    ): Promise<Array<{ url: string }>> {
        const dateStr = date.format('YYYY-MM-DD');

        // Try to get from cache
        const cached = await this.sitemapRepo.findOne({
            where: { source: 'vnexpress', date: dateStr },
        });

        if (cached) {
            return cached.urls;
        }

        // Fetch and cache if not found
        const urls = await this.fetchSitemapUrls(date);

        await this.sitemapRepo.upsert({
            source: 'vnexpress',
            date: dateStr,
            urls: urls
        }, {
            conflictPaths: ['source', 'date'],
            skipUpdateIfNoValuesChanged: true
        });

        return urls;
    }

    private async getCachedOrFetchArticles(articleIds: string[], onProgress: ProgressCallback): Promise<CachedArticle[]> {
        // Get existing articles
        const existingArticles = await this.articleRepo.find({
            where: {
                source: 'vnexpress',
                articleId: In(articleIds)
            }
        });
        const existingIds = new Set(existingArticles.map(a => a.articleId));

        // Filter out new articles and deduplicate them
        const newArticleIds = [...new Set(articleIds.filter(id => !existingIds.has(id)))];

        if (newArticleIds.length > 0) {
            // Fetch details for new articles
            const articleDetails = await this.fetchArticleDetails(newArticleIds, onProgress);
            
            // Prepare bulk insert data and ensure uniqueness
            const articlesToInsert = Array.from(
                new Map(articleDetails.map(article => [
                    `${article.id}`, // use articleId as key
                    {
                        source: 'vnexpress',
                        articleId: article.id,
                        title: article.title,
                        url: article.url,
                        type: article.type
                    }
                ])).values()
            );

            // Bulk upsert in batches of 500
            const batchSize = 500;
            for (let i = 0; i < articlesToInsert.length; i += batchSize) {
                const batch = articlesToInsert.slice(i, i + batchSize);
                await this.articleRepo.upsert(batch, {
                    conflictPaths: ['source', 'articleId'],
                    skipUpdateIfNoValuesChanged: true
                });
            }

            // Fetch all articles again to get the complete list
            return this.articleRepo.find({
                where: {
                    source: 'vnexpress',
                    articleId: In(articleIds)
                }
            });
        }

        return existingArticles;
    }

    async crawl(
        days: number,
        onProgress: ProgressCallback
    ): Promise<CrawlerResult[]> {
        const dates = Array.from({ length: days }, (_, i) =>
            moment().subtract(i + 1, 'days')
        );
        onProgress(5, 'Fetching article URLs from sitemaps...');

        // Fetch all URLs from sitemaps (using cache)
        const allUrls = await Promise.all(
            dates.map((date) => this.getCachedOrFetchSitemap(date))
        );
        const urls = allUrls.flat();
        onProgress(15, 'Extracting article IDs...');

        // Extract article IDs
        const articleIds = this.extractArticleIds(urls.map((url) => url.url));
        onProgress(20, 'Fetching article details...');

        // Fetch article details (using cache)
        const articles = await this.getCachedOrFetchArticles(articleIds, onProgress);
        onProgress(50, 'Fetching comment likes...');

        // Fetch comment likes (no caching as these change frequently)
        const articleResults: CrawlerResult[] = [];
        const totalBatches = Math.ceil(articles.length / 10);
        let completedBatches = 0;

        for (let i = 0; i < articles.length; i += 10) {
            const batch = articles.slice(i, i + 10);
            const commentResults = await Promise.all(
                batch.map((article) =>
                    this.fetchCommentLikes({
                        id: article.articleId,
                        type: article.type,
                        title: article.title,
                        url: article.url,
                        totalLikes: 0,
                        totalComments: 0,
                    })
                )
            );

            articleResults.push(...commentResults);
            completedBatches++;
            const progress =
                50 + Math.floor((completedBatches / totalBatches) * 45);
            onProgress(
                progress,
                `Processing articles ${i + 1}-${Math.min(
                    i + 10,
                    articles.length
                )}...`
            );
        }

        // Sort by total reactions and get top 10
        const sortedResults = articleResults
            .sort((a, b) => {
                const totalA = a.reactions + a.comments;
                const totalB = b.reactions + b.comments;
                return totalB - totalA;
            })
            .slice(0, 10);

        onProgress(100, 'Completed!');
        return sortedResults;
    }

    // Make other functions private instance methods
    private async fetchSitemapUrls(
        date: moment.Moment
    ): Promise<Array<{ url: string }>> {
        try {
            const sitemapUrl = `https://vnexpress.net/articles-${date.format(
                'YYYY'
            )}-sitemap.xml?m=${date.format('M')}&d=${date.format('D')}`;
            const response = await this.httpClient.get(sitemapUrl);
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(response.data);
            return result.urlset.url.map((url: any) => ({
                url: url.loc[0],
            }));
        } catch (error) {
            console.error('Error fetching sitemap URLs:', error);
            return [];
        }
    }

    // ... other methods ...
    private extractArticleIds(urls: string[]): string[] {
        return urls
            .map((url) => {
                const match = url.match(/(\d+)\.html$/);
                return match ? match[1] : '';
            })
            .filter((id) => id !== '');
    }

    private async fetchArticleDetails(
        articleIds: string[],
        onProgress: ProgressCallback
    ): Promise<Article[]> {
        try {
            const batchSize = 100;
            const articles: Article[] = [];
            const totalBatches = Math.ceil(articleIds.length / batchSize);
            let completedBatches = 0;
            for (let i = 0; i < articleIds.length; i += batchSize) {
                const batch = articleIds.slice(i, i + batchSize);
                try {
                    const response =
                        await this.httpClient.get<ArticleBasicResponse>(
                            'https://gw.vnexpress.net/ar/get_basic',
                            {
                                params: {
                                    article_id: batch.join(','),
                                    data_select:
                                        'title,share_url,article_type,publish_time',
                                },
                                headers: {
                                    'User-Agent':
                                        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                                    Referer: 'https://vnexpress.net/',
                                    Origin: 'https://vnexpress.net',
                                },
                            }
                        );
                    const batchArticles = response.data.data.map((item) => ({
                        id: item.article_id,
                        type: item.article_type,
                        title: item.title,
                        url: item.share_url,
                        totalLikes: 0,
                        totalComments: 0,
                    }));
                    articles.push(...batchArticles);
                    completedBatches++;
                    const progress =
                        20 + Math.floor((completedBatches / totalBatches) * 30);
                    onProgress(
                        progress,
                        `Processing articles ${i + 1}-${Math.min(
                            i + batchSize,
                            articleIds.length
                        )}...`
                    );
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

    private async fetchCommentLikes(article: Article): Promise<CrawlerResult> {
        try {
            let totalLikes = 0;
            let totalComments = 0;
            let offset = 0;
            const limit = 100;
            const maxRounds = 20;
            let currentRound = 0;

            while (currentRound < maxRounds) {
                const response = await this.httpClient.get<CommentResponse>(
                    'https://usi-saas.vnexpress.net/index/get',
                    {
                        params: {
                            offset: offset,
                            limit: limit,
                            frommobile: 0,
                            sort_by: 'like',
                            is_onload: 1,
                            objectid: article.id,
                            objecttype: article.type,
                            siteid: 1000000,
                        },
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                            Referer: 'https://vnexpress.net/',
                            Origin: 'https://vnexpress.net',
                        },
                    }
                );

                const comments = response.data.data.items;
                totalComments += comments.length;
                totalLikes += comments.reduce(
                    (sum, comment) => sum + comment.userlike,
                    0
                );

                if (comments.length < limit) {
                    break;
                }

                offset += limit;
                currentRound++;
            }

            return {
                title: article.title,
                url: article.url,
                reactions: totalLikes,
                comments: totalComments,
            };
        } catch (error) {
            console.error(
                `Error fetching comments for article ${article.id}:`,
                error
            );
            return {
                title: article.title,
                url: article.url,
                reactions: 0,
                comments: 0,
            };
        }
    }
}
