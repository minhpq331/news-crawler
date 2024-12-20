document.addEventListener('DOMContentLoaded', async () => {
    const runButton = document.getElementById('runCrawler');
    const progressBar = document.getElementById('progressBar');
    const resultsTable = document.getElementById('resultsTable');
    const sourceSelect = document.getElementById('newsSource');
    const progressText = document.getElementById('progressText');

    async function loadResults(source) {
        try {
            const baseUrl = window.API_BASE_URL || 'http://localhost:3000';
            const response = await fetch(`${baseUrl}/api/results/${source}`);
            
            if (response.status === 404) {
                resultsTable.innerHTML = '';
                progressText.innerHTML = `
                    <div class="alert alert-warning" role="alert">
                        No data available for ${source}. Please run the crawler to fetch data.
                    </div>`;
                return;
            }

            if (!response.ok) {
                throw new Error('Failed to fetch results');
            }

            const data = await response.json();
            displayResults(data.results, data.updatedAt);
        } catch (error) {
            console.error('Error loading cached results:', error);
            progressText.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    Error loading results. Please try again later.
                </div>`;
        }
    }

    // Load initial results
    await loadResults(sourceSelect.value);

    // Handle source change
    sourceSelect.addEventListener('change', async () => {
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        await loadResults(sourceSelect.value);
    });

    runButton.addEventListener('click', async () => {
        try {
            // Disable controls
            runButton.disabled = true;
            sourceSelect.disabled = true;
            resultsTable.innerHTML = '';
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';

            // Start the crawling process
            const baseUrl = window.API_BASE_URL || 'http://localhost:3000';
            const response = await fetch(`${baseUrl}/api/crawl`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    source: sourceSelect.value
                })
            });

            if (!response.ok) {
                throw new Error('Crawling failed');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const lines = text.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.progress) {
                            progressBar.style.width = `${data.progress}%`;
                            progressBar.textContent = `${data.progress}%`;
                            progressText.textContent = data.message;
                        }

                        if (data.completed && data.results) {
                            displayResults(data.results);
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred while crawling');
        } finally {
            // Re-enable controls
            runButton.disabled = false;
            sourceSelect.disabled = false;
        }
    });
});

function displayResults(results, updatedAt) {
    const resultsTable = document.getElementById('resultsTable');
    const progressText = document.getElementById('progressText');
    
    if (updatedAt) {
        const date = new Date(updatedAt);
        progressText.textContent = `Last updated: ${date.toLocaleString()}`;
    }
    
    resultsTable.innerHTML = results
        .map((result, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${result.title}</td>
                <td>${result.reactions}</td>
                <td>${result.comments}</td>
                <td><a href="${result.url}" target="_blank">Link</a></td>
            </tr>
        `)
        .join('');
} 