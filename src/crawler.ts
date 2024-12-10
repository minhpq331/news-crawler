// src/crawler.ts
import { crawlVnExpress } from './vnexpress';
import { crawlTuoiTre } from './tuoitre';

export interface CrawlerResult {
    title: string;
    url: string;
    reactions: number;
    comments: number;
}

export interface ProgressCallback {
    (progress: number, message?: string): void;
}

export async function runCrawler(
    source: 'vnexpress' | 'tuoitre',
    onProgress: ProgressCallback
): Promise<CrawlerResult[]> {
    switch (source) {
        case 'vnexpress':
            return crawlVnExpress(onProgress);
        case 'tuoitre':
            return crawlTuoiTre(onProgress);
        default:
            throw new Error('Invalid source');
    }
}