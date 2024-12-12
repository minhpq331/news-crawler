import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import moment from 'moment';
import { TuoiTreCrawler } from './TuoiTreCrawler';

describe('TuoiTreCrawler', () => {
    let mock: MockAdapter;
    let crawler: TuoiTreCrawler;
    let mockProgress: jest.Mock;

    beforeEach(() => {
        const axiosInstance = axios.create();
        mock = new MockAdapter(axiosInstance);
        crawler = new TuoiTreCrawler(axiosInstance);
        mockProgress = jest.fn();
    });

    afterEach(() => {
        mock.reset();
    });

    it('should fetch and process articles correctly', async () => {
        // Mock sitemap response
        const sitemapDate = moment().subtract(1, 'days');
        const sitemapUrl = `https://tuoitre.vn/StaticSitemaps/sitemaps-${sitemapDate.format('YYYY')}-${sitemapDate.format('MM')}.xml`;
        
        mock.onGet(sitemapUrl).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://tuoitre.vn/article-${sitemapDate.format('YYYYMMDD')}01.htm</loc>
                    <image:image>
                        <image:title><![CDATA[Test Article]]></image:title>
                    </image:image>
                </url>
            </urlset>
        `);

        // Mock comments response
        mock.onGet('https://id.tuoitre.vn/api/getlist-comment.api').reply(200, {
            Data: JSON.stringify([
                {
                    reactions: {
                        like: 10,
                        love: 5
                    }
                },
                {
                    reactions: {
                        like: 3,
                        wow: 2
                    }
                }
            ])
        });

        const results = await crawler.crawl(1,mockProgress);

        // Verify results
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            title: 'Test Article',
            url: expect.stringContaining('tuoitre.vn/article'),
            reactions: 20, // Sum of all reactions
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
        expect(console.error).toHaveBeenCalledWith(`Error fetching sitemap for ${sitemapDate.format('YYYY-MM')}:`, expect.any(Error));
    });

    it('should handle comment fetch errors', async () => {
        // Mock successful sitemap response but failed comments
        const sitemapDate = moment().subtract(1, 'days');
        mock.onGet(/.*sitemaps.*\.xml/).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://tuoitre.vn/article-${sitemapDate.format('YYYYMMDD')}01.htm</loc>
                    <image:image>
                        <image:title><![CDATA[Test Article]]></image:title>
                    </image:image>
                </url>
            </urlset>
        `);

        mock.onGet('https://id.tuoitre.vn/api/getlist-comment.api').reply(500);

        const results = await crawler.crawl(1, mockProgress);
        expect(results).toHaveLength(1);
        expect(results[0].reactions).toBe(0);
        expect(results[0].comments).toBe(0);
    });

    it('should filter articles by date correctly', async () => {
        // Mock sitemap with articles from different dates
        const oldDate = moment().subtract(10, 'days').format('YYYYMMDD');
        const validDate = moment().subtract(1, 'days').format('YYYYMMDD');
        
        mock.onGet(/.*sitemaps.*\.xml/).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://tuoitre.vn/article-${oldDate}01.htm</loc>
                    <image:image>
                        <image:title><![CDATA[Old Article]]></image:title>
                    </image:image>
                </url>
                <url>
                    <loc>https://tuoitre.vn/article-${validDate}01.htm</loc>
                    <image:image>
                        <image:title><![CDATA[Valid Article]]></image:title>
                    </image:image>
                </url>
            </urlset>
        `);

        mock.onGet('https://id.tuoitre.vn/api/getlist-comment.api').reply(200, {
            Data: '[]'
        });

        const results = await crawler.crawl(1, mockProgress);
        expect(results.map(r => r.title)).toContain('Valid Article');
        expect(results.map(r => r.title)).not.toContain('Old Article');
    });
}); 