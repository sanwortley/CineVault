const db = require('./backend/db.js');
db.getMovies().then(res => console.log(Object.keys(res[0] || {}))).catch(console.error);
