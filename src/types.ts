export interface CrawlerResult {
    title: string;
    url: string;
    reactions: number;
    comments: number;
}

export interface ProgressCallback {
    (progress: number, message?: string): void;
}

export interface NewsCrawlerService {
    crawl(days: number, onProgress: ProgressCallback): Promise<CrawlerResult[]>;
} 