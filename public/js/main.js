document.addEventListener('DOMContentLoaded', () => {
    const runButton = document.getElementById('runCrawler');
    const progressBar = document.getElementById('progressBar');
    const resultsTable = document.getElementById('resultsTable');
    const sourceSelect = document.getElementById('newsSource');

    runButton.addEventListener('click', async () => {
        try {
            // Disable controls
            runButton.disabled = true;
            sourceSelect.disabled = true;
            resultsTable.innerHTML = '';
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';

            // Start the crawling process
            const response = await fetch('http://localhost:3000/api/crawl', {
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

function displayResults(results) {
    const resultsTable = document.getElementById('resultsTable');
    
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