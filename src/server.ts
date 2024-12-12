import express from 'express';
import cors from 'cors';
import path from 'path';
import { getCrawler } from './services/crawlers';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Endpoint to start crawling
app.post('/api/crawl', async (req, res) => {
    const { source } = req.body;
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        let results;
        const crawler = getCrawler(source);
        results = await crawler.crawl(7, (progress: number, message?: string) => {
            res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
        });

        // Send final results
        res.write(`data: ${JSON.stringify({ completed: true, results })}\n\n`);
        res.end();
    } catch (error) {
        res.status(500).json({ error: 'Crawling failed' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 