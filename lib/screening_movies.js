'use strict';

let url = require('url');
let async = require('async');
let request = require('request');
let cheerio = require('cheerio');

const TIMEZONE_OFFSET_KST = -32400000;

const getCGVMovies = (option, callback) => {
    let result = [];
    async.waterfall([
    cb => request('http://www.cgv.co.kr/movies/pre-movies.aspx', cb),
    (resp, body, cb) => {
        let $ = cheerio.load(body);
        let links = $('.sect-movie-chart ol > li .box-image > a').map((i, a) => url.resolve(resp.request.href, $(a).attr('href')));
        async.eachLimit(links, 4, (link, next) => async.waterfall([
        cb => request(link, cb),
        (resp, body, cb) => {
            let $ = cheerio.load(body);
            let $movieSection = $('#select_main .sect-base-movie');
            let genreText = $movieSection.find('.box-contents .spec dl dt')
                .filter((i, dt) => $(dt).text().split(':')[0].trim() === '장르')
                .text().trim();
            if (option.genre) {
                genreText = (genreText.split(':')[1] || '').trim();
                let genres = genreText.split(',').map(genre => genre.trim());
                if (genres.indexOf(option.genre) < 0) return next(null);
            }

            let releasdDateText = $movieSection.find('.box-contents .spec dl dt')
                .filter((i, dd) => $(dd).text().split(':')[0].trim() === '개봉')
                .next('dd').text().replace('(재개봉)', '').trim();

            result.push({
                title: $movieSection.find('.box-contents .title > strong').text().trim(),
                image: $movieSection.find('.box-image .thumb-image img').attr('src'),
                link: resp.request.href,
                releaseDate: new Date(Number(new Date(releasdDateText)) + TIMEZONE_OFFSET_KST),
                theaterBrandName: 'CGV',
            });
            next(null);
        }
        ], next), cb);
    }
    ],
    err => callback(err, result));
};

const getLottecinemaMovies = (option, callback) => {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

    let cookieJar = request.jar();
    async.waterfall([
    cb => request({
        url: 'http://www.lottecinema.co.kr/LCHS/Contents/Movie/Movie-List.aspx',
        headers: {
            'User-Agent': USER_AGENT
        },
        jar: cookieJar
    }, cb),
    (resp, body, cb) => {
        let param = {
            MethodName: 'GetMovies',
            channelType: 'HO',
            osType: 'Chrome',
            osVersion: USER_AGENT,
            multiLanguageID: 'KR',
            division: 1,
            moviePlayYN: 'N',
            orderType: '5',
            blockSize: 100,
            pageNo: 1
        };
        request.post({
            url: 'http://www.lottecinema.co.kr/LCWS/Movie/MovieData.aspx',
            headers: {
                'User-Agent': USER_AGENT,
                'X-Requested-With': 'XMLHttpRequest',
                Origin: 'http://www.lottecinema.co.kr',
                Referer: resp.request.href
            },
            jar: cookieJar,
            form: { paramList: JSON.stringify(param) },
        }, cb);
    },
    (resp, body, cb) => {
        let movieList;
        try {
            movieList = JSON.parse(body).Movies.Items;
        }
        catch(e) {
            return cb(e);
        }
        if (option.genre) movieList = movieList.filter(movie => movie.MovieGenreName && movie.MovieGenreName.split('/').indexOf(option.genre) >= 0);
        callback(null, movieList
            .map(movie => ({
                title: movie.MovieNameKR,
                image: movie.PosterURL,
                link: `http://www.lottecinema.co.kr/LCHS/Contents/Movie/Movie-Detail-View.aspx?movie=${movie.RepresentationMovieCode}`,
                releaseDate: new Date(Number(new Date(movie.ReleaseDate.substr(0, 10))) + TIMEZONE_OFFSET_KST),
                theaterBrandName: 'Lotte Cinema'
            })));
    }
    ], callback);
};

const getMegaboxMovies = (option, callback) => {
    let result = [];
    async.waterfall([
    cb => request.post({
        url: 'http://www.megabox.co.kr/pages/movie/Movie_List.jsp',
        form: {
            menuId: 'movie-scheduled',
            startNo: 0,
            count: 64,
            sort: 'releaseDate'
        }
    }, cb),
    (resp, body, cb) => {
        let $ = cheerio.load(body);
        let movieCodes = $('li.item .movie_info a.film_title').map((i, a) => {
            let onClick = $(a).attr('onclick');
            let m = onClick.match(/showPage\(['"](\d+)/);
            return m[1];
        });

        async.eachLimit(movieCodes, 4, (movieCode, next) => async.waterfall([
        cb => request.post({
            url: 'http://www.megabox.co.kr/pages/movie/Movie_Detail.jsp',
            form: { code: movieCode }
        }, cb),
        (resp, body, cb) => {
            let $ = cheerio.load(body);
            if (option.genre) {
                let genreText = $('ul.info_wrap li').filter((i, li) => $(li).find('strong').text().trim() === '장르').text();
                genreText = (genreText.split(':')[1] || '').split('/')[0].trim();
                let genres = genreText.split(',').map(genre => genre.trim());
                if (genres.indexOf(option.genre) < 0) return next(null);
            }

            let releasdDateText = $('ul.info_wrap li').filter((i, li) => $(li).find('strong').text().trim() === '개봉일').text();
            releasdDateText = (releasdDateText.split(':')[1] || '').trim();

            let $img = $('.popup_box .left_wrap img');
            result.push({
                title: $img.attr('alt'),
                image: $img.attr('src'),
                link: $('.social_btn_wrap .fb-share-button').data('href'),
                releaseDate: new Date(Number(new Date(releasdDateText)) + TIMEZONE_OFFSET_KST),
                theaterBrandName: 'Megabox'
            });
            next(null);
        }
        ], next), cb);
    }
    ],
    err => callback(err, result));
};

const getKoMovies = (option, callback) => async.waterfall([
cb => async.parallel([
    async.apply(getCGVMovies, option),
    async.apply(getLottecinemaMovies, option),
    async.apply(getMegaboxMovies, option)
], cb),
(results, cb) => callback(null, results.reduce((prev, current) => prev.concat(current), [])
    .sort((a, b) => (Number(a.releaseDate) || Number.POSITIVE_INFINITY) - (Number(b.releaseDate) || Number.POSITIVE_INFINITY)))
], callback);

module.exports = {
    getCGVMovies: getCGVMovies,
    getLottecinemaMovies: getLottecinemaMovies,
    getMegaboxMovies: getMegaboxMovies,
    getKoMovies: getKoMovies
};
