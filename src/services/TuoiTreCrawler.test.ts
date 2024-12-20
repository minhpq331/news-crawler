import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import moment from 'moment';
import { TuoiTreCrawler } from './TuoiTreCrawler';
import { AppDataSource } from '../config/database';

describe('TuoiTreCrawler', () => {
    let mock: MockAdapter;
    let crawler: TuoiTreCrawler;
    let mockProgress: jest.Mock;
    let mockSitemapRepo: any;
    let mockArticleRepo: any;

    beforeEach(() => {
        const axiosInstance = axios.create();
        mock = new MockAdapter(axiosInstance);
        
        // Mock repositories
        mockSitemapRepo = {
            findOne: jest.fn(),
            upsert: jest.fn()
        };
        
        mockArticleRepo = {
            find: jest.fn(),
            upsert: jest.fn()
        };

        // Mock AppDataSource.getRepository
        jest.spyOn(AppDataSource, 'getRepository').mockImplementation((entity: any) => {
            if (entity.name === 'CachedSitemap') return mockSitemapRepo;
            if (entity.name === 'CachedArticle') return mockArticleRepo;
            return {};
        });

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
        expect(mockProgress).toHaveBeenCalledWith(100, 'Completed!');
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

    it('should bypass cache for current month sitemap but use cache for previous month', async () => {
        const currentDate = moment().subtract(1, 'days');
        const previousMonthDate = moment().subtract(1, 'days').startOf('month').subtract(1, 'days');
        
        const currentSitemapUrl = `https://tuoitre.vn/StaticSitemaps/sitemaps-${currentDate.format('YYYY')}-${currentDate.format('MM')}.xml`;
        
        // Set up cache for both months
        mockSitemapRepo.findOne.mockImplementation((options: any) => {
            const dateStr = options.where.date;
            if (dateStr.includes(previousMonthDate.format('YYYY-MM'))) {
                return Promise.resolve({
                    urls: [{
                        url: `https://tuoitre.vn/article-${previousMonthDate.format('YYYYMMDD')}01.htm`,
                        title: 'Cached Previous Month Article'
                    }]
                });
            }
            return Promise.resolve({
                urls: [{
                    url: `https://tuoitre.vn/article-${currentDate.format('YYYYMMDD')}01.htm`,
                    title: 'Cached Current Month Article'
                }]
            });
        });

        // Mock the current month sitemap response
        mock.onGet(currentSitemapUrl).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://tuoitre.vn/article-${currentDate.format('YYYYMMDD')}02.htm</loc>
                    <image:image>
                        <image:title><![CDATA[Fresh Current Month Article]]></image:title>
                    </image:image>
                </url>
            </urlset>
        `);

        // Mock comments response
        mock.onGet('https://id.tuoitre.vn/api/getlist-comment.api').reply(200, {
            Data: JSON.stringify([])
        });

        const results = await crawler.crawl(40, mockProgress);

        // Should get both the fresh current month article and cached previous month article
        expect(results).toHaveLength(2);
        expect(results.map(r => r.title)).toContain('Fresh Current Month Article');
        expect(results.map(r => r.title)).toContain('Cached Previous Month Article');
        
        // Verify cache was checked for previous month
        expect(mockSitemapRepo.findOne).toHaveBeenCalledWith({
            where: {
                source: 'tuoitre',
                date: expect.stringContaining(previousMonthDate.format('YYYY-MM')),
            }
        });
        
        // Verify only current month sitemap was fetched from network
        const sitemapRequests = mock.history.get.filter(req => req.url?.includes('StaticSitemaps'));
        expect(sitemapRequests).toHaveLength(1);
        expect(sitemapRequests[0].url).toBe(currentSitemapUrl);
    });

    it('should cache sitemap data after fetching', async () => {
        const sitemapDate = moment().subtract(40, 'days'); // Use previous month to ensure caching
        const dateStr = sitemapDate.format('YYYY-MM-DD');
        const sitemapUrl = `https://tuoitre.vn/StaticSitemaps/sitemaps-${sitemapDate.format('YYYY')}-${sitemapDate.format('MM')}.xml`;
        
        // Mock cache miss
        mockSitemapRepo.findOne.mockResolvedValue(null);

        // Mock sitemap response
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
            Data: JSON.stringify([])
        });

        await crawler.crawl(40, mockProgress);

        // Verify cache operations
        expect(mockSitemapRepo.findOne).toHaveBeenCalledWith({
            where: { source: 'tuoitre', date: sitemapDate.startOf('month').format('YYYY-MM-DD') }
        });

        expect(mockSitemapRepo.upsert).toHaveBeenCalled();

        // Verify network request was made
        const sitemapRequests = mock.history.get.filter(req => req.url === sitemapUrl);
        expect(sitemapRequests).toHaveLength(1);
    });
}); 