const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

app.get('/', (req, res) => {
	res.json({
		message: "Hello from the container!",
		timestamp: new Date().toISOString(),
		environment: process.env.NODE_ENV || 'development'
	});
});

app.get('/health', (req, res) => {
	res.json({
		status: 'healthy',
		uptime: process.uptime(),
		memory: process.memoryUsage()
	});
});

app.post('/echo', (req, res) => {
	res.json({
		received: req.body,
		headers: req.headers,
		method: req.method
	});
});

app.listen(port, '0.0.0.0', () => {
	console.log(`API server listening on port ${port}`);
});