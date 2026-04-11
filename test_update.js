const db = require('./backend/db.js');
db.updateMovieProgress(4, 75).then(() => console.log('OK')).catch(e => console.error(e.message));
