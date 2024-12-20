import "reflect-metadata";
import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import path from 'path';
import { getCrawler } from './services/crawlers';
import { AppDataSource } from './config/database';
import { CrawlResult } from './entities/CrawlResult';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Get cached results
app.get('/api/results/:source', (async (req: Request, res: Response) => {
    try {
        const { source } = req.params;
        const crawlResultRepo = AppDataSource.getRepository(CrawlResult);
        
        const result = await crawlResultRepo.findOne({
            where: { source },
            order: { updatedAt: 'DESC' }
        });

        if (!result) {
            return res.status(404).json({ error: 'No results found' });
        }

        res.json({
            results: result.results,
            updatedAt: result.updatedAt
        });
    } catch (error) {
        console.error('Error fetching results:', error);
        res.status(500).json({ error: 'Failed to fetch results' });
    }
}) as RequestHandler);

// Endpoint to start crawling
app.post('/api/crawl', (async (req: Request, res: Response) => {
    const { source } = req.body;
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        const crawlResultRepo = AppDataSource.getRepository(CrawlResult);
        const crawler = getCrawler(source);
        
        const results = await crawler.crawl(7, (progress: number, message?: string) => {
            res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
        });

        // Upsert results to database
        await crawlResultRepo.upsert({
            source,
            results
        }, ['source']);

        // Send final results
        res.write(`data: ${JSON.stringify({ completed: true, results })}\n\n`);
        res.end();
    } catch (error) {
        console.error('Error during crawl:', error);
        res.status(500).json({ error: 'Crawling failed' });
    }
}) as RequestHandler);

// Initialize database connection before starting server
AppDataSource.initialize().then(() => {
    console.log("Database connection initialized");
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}).catch(error => console.log(error)); 