import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import moment from 'moment';
import { ProgressCallback, CrawlerResult } from './crawler';

export async function crawlTuoiTre(onProgress: ProgressCallback): Promise<CrawlerResult[]> {
    // Get last 7 days (don't include today)
    const dates = Array.from({length: 7}, (_, i) => moment().subtract(i + 1, 'days'));
    onProgress(5, 'Fetching article URLs from sitemaps...');

    // Fetch all URLs from sitemaps
    const monthsProcessed = new Set<string>();
    const allUrls = await Promise.all(dates
        .filter(date => {
            const monthKey = date.format('YYYY-MM');
            if (monthsProcessed.has(monthKey)) return false;
            monthsProcessed.add(monthKey);
            return true;
        })
        .map(date => fetchSitemapUrls(date)));
    const allMonthUrls = allUrls.flat();
    onProgress(15, 'Filtering articles by date...');

    // Filter URLs for only the dates we want
    const urls = allMonthUrls.filter(urlObj => {
        const articleId = extractArticleId(urlObj.url);
        if (!articleId) return false;
        const urlDate = moment(articleId.substring(0, 8), 'YYYYMMDD');
        return dates.some(date => date.isSame(urlDate, 'day'));
    });
    onProgress(25, 'Fetching article reactions...');

    // Process articles in batches of 10
    const articles: Article[] = [];
    const batchSize = 10;
    const totalBatches = Math.ceil(urls.length / batchSize);
    let completedBatches = 0;

    for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(async (urlObj) => {
                const articleId = extractArticleId(urlObj.url);
                if (!articleId) return null;

                const result = await fetchArticleComments(articleId);
                return {
                    url: urlObj.url,
                    title: urlObj.title,
                    articleId,
                    totalReactions: result.reactions,
                    totalComments: result.comments
                };
            })
        );

        articles.push(...batchResults.filter((article): article is NonNullable<typeof article> => article !== null));
        
        completedBatches++;
        const progress = 25 + Math.floor((completedBatches / totalBatches) * 70);
        onProgress(progress, `Processing articles ${i + 1}-${Math.min(i + batchSize, urls.length)}...`);
    }

    // Sort and get top 10 articles by total reactions
    const topArticles = articles
        .sort((a, b) => b.totalReactions - a.totalReactions)
        .slice(0, 10);

    onProgress(100, 'Done!');

    // Return results in CrawlerResult format
    return topArticles.map(article => ({
        title: article.title,
        url: article.url,
        reactions: article.totalReactions,
        comments: article.totalComments
    }));
}

interface Article {
    url: string;
    title: string;
    articleId: string;
    totalReactions: number;
    totalComments: number;
}

interface SitemapArticle {
    url: string;
    lastmod: string;
    changefreq: string;
    priority: string;
    image: {
        loc: string;
        title: string;
    };
}

interface CommentResponse {
    Data: string; // JSON string containing comments
}

interface Comment {
    reactions: {
        [key: string]: number;
    };
}

async function fetchSitemapUrls(date: moment.Moment): Promise<{url: string, title: string}[]> {
    const url = `https://tuoitre.vn/StaticSitemaps/sitemaps-${date.format('YYYY')}-${date.format('MM')}.xml`;
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
            }
        });
        const result = await parseStringPromise(response.data);
        const articles = result.urlset.url.map((article: any) => {
            const url = article.loc[0];
            const title = article['image:image'][0]['image:title'][0].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1');
            return { url, title };
        });
        return articles;
    } catch (error) {
        console.error(`Error fetching sitemap for ${date.format('YYYY-MM')}:`, error);
        return [];
    }
}

function extractArticleId(url: string): string {
    const match = url.match(/(\d+)\.htm$/);
    return match ? match[1] : '';
}

async function fetchArticleComments(articleId: string): Promise<{reactions: number, comments: number}> {
    const url = 'https://id.tuoitre.vn/api/getlist-comment.api';
    const pageSize = 100;
    let pageIndex = 1;
    let totalReactions = 0;
    let totalComments = 0;
    const maxPages = 20;
    
    try {
        while (pageIndex <= maxPages) {
            const response = await axios.get<CommentResponse>(url, {
                params: {
                    pageindex: pageIndex,
                    pagesize: pageSize,
                    objId: articleId,
                    objType: 1,
                    sort: 2
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
                }
            });

            const comments: Comment[] = JSON.parse(response.data.Data);
            totalComments += comments.length;
            
            // Calculate reactions for current page
            const pageReactions = comments.reduce((total, comment) => {
                return total + Object.values(comment.reactions).reduce((sum, count) => sum + count, 0);
            }, 0);
            
            totalReactions += pageReactions;

            if (comments.length < pageSize) {
                break;
            }

            pageIndex++;
        }

        return { reactions: totalReactions, comments: totalComments };
    } catch (error) {
        console.error(`Error fetching comments for article ${articleId}:`, error);
        return { reactions: 0, comments: 0 };
    }
}