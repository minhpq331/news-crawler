// src/index.ts
import axios from 'axios';
import xml2js from 'xml2js';
import moment from 'moment';

interface Article {
    id: string;
    type: number;
    title: string;
    url: string;
    totalLikes: number;
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
        const url = `https://gw.vnexpress.net/ar/get_basic?article_id=${batch.join(',')}&data_select=title,share_url,article_type,publish_time`;
        
        try {
            const response = await axios.get<ArticleBasicResponse>(url, {
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
                totalLikes: 0
            }));
            articles.push(...batchArticles);
        } catch (error) {
            console.error('Error fetching article details:', error);
        }
    }

    return articles;
}

async function fetchCommentLikes(article: Article): Promise<number> {
    const url = `https://usi-saas.vnexpress.net/index/get?offset=0&limit=100&frommobile=0&sort_by=like&is_onload=1&objectid=${article.id}&objecttype=${article.type}&siteid=1000000`;
    
    try {
        const response = await axios.get<CommentResponse>(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Referer': 'https://vnexpress.net/',
                'Origin': 'https://vnexpress.net'
            }
        });
        console.log(response.data);
        return response.data.data.items.reduce((sum, comment) => sum + comment.userlike, 0);
    } catch (error) {
        console.error(`Error fetching comments for article ${article.id}:`, error);
        return 0;
    }
}

async function main() {
    // Get last 7 days
    // const dates = Array.from({length: 7}, (_, i) => moment().subtract(i, 'days'));
    const dates = Array.from({length: 1}, (_, i) => moment().subtract(i+1, 'days'));
    
    // Fetch all URLs from sitemaps
    const allUrls = await Promise.all(dates.map(date => fetchSitemapUrls(date)));
    const urls = allUrls.flat();

    console.log(urls);
    
    // Extract article IDs
    const articleIds = extractArticleIds(urls);
    
    // Fetch article details
    const articles = await fetchArticleDetails(articleIds);
    
    // Fetch comment likes for each article
    for (const article of articles) {
        article.totalLikes = await fetchCommentLikes(article);
    }
    
    // Sort and get top 10 articles by total likes
    const topArticles = articles
        .sort((a, b) => b.totalLikes - a.totalLikes)
        .slice(0, 10);
    
    // Output results
    console.log('Top 10 Articles by Comment Likes:');
    topArticles.forEach((article, index) => {
        console.log(`${index + 1}. ${article.title}`);
        console.log(`   Total Likes: ${article.totalLikes}`);
        console.log(`   URL: ${article.url}`);
        console.log('---');
    });
}

// Run the script
main().catch(console.error);