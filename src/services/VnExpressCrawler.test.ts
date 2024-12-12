import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import moment from 'moment';
import { VnExpressCrawler } from './VnExpressCrawler';

describe('VnExpressCrawler', () => {
    let mock: MockAdapter;
    let crawler: VnExpressCrawler;
    let mockProgress: jest.Mock;

    beforeEach(() => {
        const axiosInstance = axios.create();
        mock = new MockAdapter(axiosInstance);
        crawler = new VnExpressCrawler(axiosInstance);
        mockProgress = jest.fn();
    });

    afterEach(() => {
        mock.reset();
    });

    it('should fetch and process articles correctly', async () => {
        // Mock sitemap response
        const sitemapDate = moment().subtract(1, 'days');
        const sitemapUrl = `https://vnexpress.net/articles-${sitemapDate.format('YYYY')}-sitemap.xml?m=${sitemapDate.format('M')}&d=${sitemapDate.format('D')}`;
        
        mock.onGet(sitemapUrl).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://vnexpress.net/article-123456.html</loc>
                </url>
            </urlset>
        `);

        // Mock article details response
        mock.onGet('https://gw.vnexpress.net/ar/get_basic').reply(200, {
            code: 0,
            data: [{
                article_id: '123456',
                article_type: 1,
                title: 'Test Article',
                share_url: 'https://vnexpress.net/article-123456.html'
            }]
        });

        // Mock comments response
        mock.onGet('https://usi-saas.vnexpress.net/index/get').reply(200, {
            error: 0,
            data: {
                items: [
                    { userlike: 10 },
                    { userlike: 5 }
                ]
            }
        });

        const results = await crawler.crawl(1, mockProgress);

        // Verify results
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            title: 'Test Article',
            url: 'https://vnexpress.net/article-123456.html',
            reactions: 15,
            comments: 2
        });

        // Verify progress callbacks
        expect(mockProgress).toHaveBeenCalledWith(5, expect.any(String));
        expect(mockProgress).toHaveBeenCalledWith(100, 'Done!');
    });

    it('should handle sitemap fetch errors', async () => {
        mock.onGet(/.*sitemaps.*\.xml/).reply(500);
        // mock the console.error
        console.error = jest.fn();

        const sitemapDate = moment().subtract(1, 'days');
        const results = await crawler.crawl(1, mockProgress);
        expect(results).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(`Error fetching sitemap URLs:`, expect.any(Error));
    });

    it('should handle article fetch errors', async () => {
        const sitemapDate = moment().subtract(1, 'days');
        const sitemapUrl = `https://vnexpress.net/articles-${sitemapDate.format('YYYY')}-sitemap.xml?m=${sitemapDate.format('M')}&d=${sitemapDate.format('D')}`;
        
        mock.onGet(sitemapUrl).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://vnexpress.net/article-123456.html</loc>
                </url>
            </urlset>
        `);

        mock.onGet('https://gw.vnexpress.net/ar/get_basic').reply(500);
        // mock the console.error
        console.error = jest.fn();

        const results = await crawler.crawl(1, mockProgress);
        expect(results).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(`Error fetching article details:`, expect.any(Error));
    });

    it('should handle comment fetch errors', async () => {
        const sitemapDate = moment().subtract(1, 'days');
        const sitemapUrl = `https://vnexpress.net/articles-${sitemapDate.format('YYYY')}-sitemap.xml?m=${sitemapDate.format('M')}&d=${sitemapDate.format('D')}`;
        
        mock.onGet(sitemapUrl).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://vnexpress.net/article-123456.html</loc>
                </url>
            </urlset>
        `);

        // Mock article details response
        mock.onGet('https://gw.vnexpress.net/ar/get_basic').reply(200, {
            code: 0,
            data: [{
                article_id: '123456',
                article_type: 1,
                title: 'Test Article',
                share_url: 'https://vnexpress.net/article-123456.html'
            }]
        });

        mock.onGet('https://usi-saas.vnexpress.net/index/get').reply(500);
        // mock the console.error
        console.error = jest.fn();

        const results = await crawler.crawl(1, mockProgress);
        expect(results).toHaveLength(1);
        expect(console.error).toHaveBeenCalledWith(`Error fetching comments for article 123456:`, expect.any(Error));
    });
   
}); 