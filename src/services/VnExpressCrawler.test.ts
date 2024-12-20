import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import moment from 'moment';
import { VnExpressCrawler } from './VnExpressCrawler';
import { AppDataSource } from '../config/database';

describe('VnExpressCrawler', () => {
    let mock: MockAdapter;
    let crawler: VnExpressCrawler;
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

        crawler = new VnExpressCrawler(axiosInstance);
        mockProgress = jest.fn();
    });

    afterEach(() => {
        mock.reset();
        jest.clearAllMocks();
    });

    it('should fetch and process articles correctly', async () => {
        const sitemapDate = moment().subtract(1, 'days');
        const sitemapUrl = `https://vnexpress.net/articles-${sitemapDate.format('YYYY')}-sitemap.xml?m=${sitemapDate.format('M')}&d=${sitemapDate.format('D')}`;
        
        // Mock cache miss for sitemap
        mockSitemapRepo.findOne.mockResolvedValue(null);
        
        // Mock sitemap response
        mock.onGet(sitemapUrl).reply(200, `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
                <url>
                    <loc>https://vnexpress.net/article-123456.html</loc>
                </url>
            </urlset>
        `);

        // Mock cache miss for first call, then return 1 item
        mockArticleRepo.find
            .mockResolvedValueOnce([])
            .mockResolvedValue([{
                source: 'vnexpress',
                articleId: '123456',
                title: 'Test Article',
                url: 'https://vnexpress.net/article-123456.html',
                type: 1
            }]);
        
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

        // Verify cache operations
        expect(mockSitemapRepo.findOne).toHaveBeenCalled();
        expect(mockSitemapRepo.upsert).toHaveBeenCalled();
        expect(mockArticleRepo.find).toHaveBeenCalled();
        expect(mockArticleRepo.upsert).toHaveBeenCalled();

        // Verify progress callbacks
        expect(mockProgress).toHaveBeenCalledWith(5, expect.any(String));
        expect(mockProgress).toHaveBeenCalledWith(100, 'Completed!');
    });

    it('should use cached sitemap when available', async () => {
        const sitemapDate = moment().subtract(1, 'days');
        
        // Mock cached sitemap
        mockSitemapRepo.findOne.mockResolvedValue({
            urls: [{
                url: 'https://vnexpress.net/article-123456.html'
            }]
        });

        // Mock cached article
        mockArticleRepo.find.mockResolvedValue([{
            source: 'vnexpress',
            articleId: '123456',
            title: 'Test Article',
            url: 'https://vnexpress.net/article-123456.html',
            type: 1
        }]);

        // Mock comments response
        mock.onGet('https://usi-saas.vnexpress.net/index/get').reply(200, {
            error: 0,
            data: { items: [] }
        });

        const results = await crawler.crawl(1, mockProgress);

        // Verify cache was used
        expect(mockSitemapRepo.findOne).toHaveBeenCalled();
        expect(mock.history.get.filter(req => req.url?.includes('sitemap'))).toHaveLength(0);
    });

    it('should handle sitemap fetch errors', async () => {
        mockSitemapRepo.findOne.mockResolvedValue(null);
        mockArticleRepo.find.mockResolvedValue([]);
        mock.onGet(/.*sitemap.*\.xml/).reply(500);
        console.error = jest.fn();

        const results = await crawler.crawl(1, mockProgress);
        
        expect(results).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith('Error fetching sitemap URLs:', expect.any(Error));
    });

    it('should handle article fetch errors', async () => {
        mockSitemapRepo.findOne.mockResolvedValue({
            urls: [{
                url: 'https://vnexpress.net/article-123456.html'
            }]
        });
        mockArticleRepo.find.mockResolvedValue([]);
        mock.onGet('https://gw.vnexpress.net/ar/get_basic').reply(500);
        console.error = jest.fn();

        const results = await crawler.crawl(1, mockProgress);
        
        expect(results).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith('Error fetching article details:', expect.any(Error));
    });
}); 