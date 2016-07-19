'use strict';

let func = require('./').getKoMovies;
//func = require('./').getCGVMovies;
func({ genre: '애니메이션' }, (err, items) => {
    if (err) throw err;
    console.log(items);
});
