import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import moment from 'moment';

interface SitemapArticle {
    url: string;
    lastmod: string;
    changefreq: string;
    priority: string;
    image: {
        loc: string;
        title: string; // Title is in the image data
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

async function fetchArticleComments(articleId: string): Promise<number> {
    const url = 'https://id.tuoitre.vn/api/getlist-comment.api';
    const pageSize = 100;
    let pageIndex = 1;
    let totalReactions = 0;
    const maxPages = 20; // Failsafe: limit to 2000 comments max (20 pages * 100 per page)
    
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
            
            // Calculate reactions for current page
            const pageReactions = comments.reduce((total, comment) => {
                return total + Object.values(comment.reactions).reduce((sum, count) => sum + count, 0);
            }, 0);
            
            totalReactions += pageReactions;

            // If we got fewer comments than pageSize, we've reached the end
            if (comments.length < pageSize) {
                break;
            }

            pageIndex++;
        }

        return totalReactions;
    } catch (error) {
        console.error(`Error fetching comments for article ${articleId}:`, error);
        return 0;
    }
}

async function main() {
    // Get dates for the last 7 days (+1 means we don't include today)
    const dates = Array.from({ length: 7 }, (_, i) => moment().subtract(i + 1, 'days'));
    // const dates = Array.from({ length: 1 }, (_, i) => moment().subtract(i+1, 'days'));
    
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
    
    // Filter URLs for only the dates we want
    const urls = allMonthUrls.filter(urlObj => {
        const articleId = extractArticleId(urlObj.url);

        if (!articleId) return false;
        const urlDate = moment(articleId.substring(0, 8), 'YYYYMMDD');
        return dates.some(date => date.isSame(urlDate, 'day'));
    });
    
    // Process articles and their comments
    const articleStats = await Promise.all(
        urls.map(async (urlObj) => {
            const articleId = extractArticleId(urlObj.url);
            if (!articleId) return null;

            const totalReactions = await fetchArticleComments(articleId);
            return {
                url: urlObj.url,
                title: urlObj.title,
                articleId,
                totalReactions
            };
        })
    );

    // Filter out null values and sort by reactions
    const validStats = articleStats
        .filter((stat): stat is NonNullable<typeof stat> => stat !== null)
        .sort((a, b) => b.totalReactions - a.totalReactions)
        .slice(0, 10);

    // Output results
    console.log('Top 10 Articles by Comment Reactions:');
    validStats.forEach((stat, index) => {
        console.log(`${index + 1}. URL: ${stat.url}`);
        console.log(`   Title: ${stat.title}`);
        console.log(`   Total Reactions: ${stat.totalReactions}`);
        console.log('---');
    });
}

// Run the script
main().catch(console.error);