'use strict';

let func = require('./').getKRMovies;
//func = require('./').getCGVMovies;
//func = require('./').getLottecinemaMovies;
//func = require('./').getMegaboxMovies;
func({ genre: '애니메이션' }, (err, items) => {
    if (err) throw err;
    console.log(items);
});
