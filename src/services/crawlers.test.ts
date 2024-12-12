import { VnExpressCrawler } from './VnExpressCrawler';
import { TuoiTreCrawler } from './TuoiTreCrawler';
import { getCrawler } from './crawlers';

describe('News Crawlers Factory Tests', () => {
    it('should return VnExpressCrawler for vnexpress', () => {
        const crawler = getCrawler('vnexpress');
        expect(crawler).toBeInstanceOf(VnExpressCrawler);
    });

    it('should return TuoiTreCrawler for tuoitre', () => {
        const crawler = getCrawler('tuoitre');
        expect(crawler).toBeInstanceOf(TuoiTreCrawler);
    });

    it('should throw an error for invalid source', () => {
        expect(() => getCrawler('invalid')).toThrow('Invalid source: invalid');
    });
}); 