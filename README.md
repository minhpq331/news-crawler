# news-crawler
![deploy](https://github.com/minhpq331/news-crawler/actions/workflows/deploy.yml/badge.svg)

Crawlers from VnExpress and TuoiTre to find out the most popular news.

## Demo

![demo](docs/demo.gif)

You can try it out at [https://news.toanhoczero.com](https://news.toanhoczero.com)

## How it works

1. Using sitemap to get all the news urls for the last 7 days. (exclude the current day)
2. Gather information from the urls (if needed).
3. Fetch all comments for each news and calculate total reactions.
4. Display top 10 news with most comment's reactions.

## Prerequisites

- Node.js 22
- Docker
- Docker Compose

## Run locally

1. Clone the repository
```
git clone https://github.com/minhpq331/news-crawler.git
```

2. Install dependencies
```
npm install
```

3. Run the crawler with hot reload
```
npm run dev
```

4. Open `http://localhost:3000` to view the web UI.

Or you can use docker compose to quickly run the crawler without installing any dependencies.

1. Run `docker compose up --build` to start the development server with hot reload.
2. Open `http://localhost:3000` to view the web UI.

To run the test, you can use `npm run test` or `npm run test:coverage` to display coverage report.

## Run in production

1. Copy `docker-compose.deploy.yml` to production server.
2. Run `docker compose -f docker-compose.deploy.yml up -d` to start the production server.
3. By default, the server will be deployed to `http://127.0.0.1:3000` and need a reverse proxy like nginx to handle domain mapping / SSL termination. You can change the port to 80 if you want to expose it directly.

## Some caveats

- VnExpress is blocking sitemap access from Vietnam IP addresses, so in order to run it locally, you have to use a VPN to make it work.
- For the simplicity of this project, I'm not using any database to store the data and will crawl the data from beginning every time you run the crawler.
- http / sock proxy is common way to bypass IP blocking / restriction when running crawler, but it's not implemented in this project yet.
