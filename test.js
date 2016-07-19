'use strict';

require('./').getKoMovies({ genre: '애니메이션' }, (err, items) => {
    if (err) throw err;
    console.log(items);
});
