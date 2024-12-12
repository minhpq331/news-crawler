import { VnExpressCrawler } from './VnExpressCrawler';
import { TuoiTreCrawler } from './TuoiTreCrawler';
import { NewsCrawlerService } from '../types';

export function getCrawler(source: string): NewsCrawlerService {
    if (source === 'vnexpress') {
        return new VnExpressCrawler();
    } else if (source === 'tuoitre') {
        return new TuoiTreCrawler();
    }
    throw new Error(`Invalid source: ${source}`);
}