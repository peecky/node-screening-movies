'use strict';

let url = require('url');
const Aigle = require('aigle');
let async = require('async');
const superagent = require('superagent');
let request = require('request');
let cheerio = require('cheerio');

const TIMEZONE_OFFSET_KST = -32400000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36';

const getDateFromKSTDateString = dateString => new Date(Number(new Date(dateString.replace(/\./g, '-'))) + TIMEZONE_OFFSET_KST); // https://twitter.com/crimsonpi/status/755409975799787523

const getCGVMovies = (option, callback) => {
    let result = [];
    async.waterfall([
    cb => request('http://www.cgv.co.kr/movies/pre-movies.aspx', cb),
    (resp, body, cb) => {
        let $ = cheerio.load(body);
        let links = $('.sect-movie-chart ol > li .box-image > a')
            .map((i, a) => url.resolve(resp.request.href, $(a).attr('href'))).get()
            .filter((link, i, links) => links.indexOf(link) === i); // remove duplicated
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

            let releaseDateText = $movieSection.find('.box-contents .spec dl dt')
                .filter((i, dd) => $(dd).text().split(':')[0].trim() === '개봉')
                .next('dd').text().replace('(재개봉)', '').trim();

            result.push({
                title: $movieSection.find('.box-contents .title > strong').text().trim(),
                image: $movieSection.find('.box-image .thumb-image img').attr('src'),
                link: resp.request.href,
                releaseDate: getDateFromKSTDateString(releaseDateText),
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
                releaseDate: getDateFromKSTDateString(movie.ReleaseDate.substr(0, 10)),
                theaterBrandName: 'Lotte Cinema'
            })));
    }
    ], callback);
};

const getMegaboxMovies = (option, callback) => {
    const baseURL = 'https://www.megabox.co.kr/on/oh/oha/Movie/selectMovieList.do';
    async.waterfall([async () => {
        const res = await superagent.post(baseURL)
            .set('User-Agent', USER_AGENT)
            .set('accept', 'application/json')
            .send({
                currentPage: '1',
                recordCountPerPage: '20',
                pageType: 'rfilmDe',
                ibxMovieNmSearch: '',
                onairYn: 'MSC02',
                specialType: '',
            });
        return (await Aigle.mapLimit(res.body.movieList, 4, async info => {
            const { rpstMovieNo } = info;
            const res = await superagent.post('https://www.megabox.co.kr/on/oh/oha/Movie/selectMovieInfo.do')
                .set('User-Agent', USER_AGENT)
                .send({ rpstMovieNo });
            const $ = cheerio.load(res.text);
            const $movieInfo = $('.movie-info');
            if (!$movieInfo.text().includes('애니메이션')) return null;

            let releaseDate = null;
            $movieInfo.find('p').each((i, elem) => {
                const text = $(elem).text();
                const m = text.match(/개봉일\s*:\s*([\d.]+)/);
                if (m) {
                    releaseDate = getDateFromKSTDateString(m[1]);
                    return false; // break;
                }
                return true;
            });

            return {
                title: info.movieNm,
                image: url.resolve(baseURL, info.imgPathNm),
                link: `https://www.megabox.co.kr/movie-detail?rpstMovieNo=${encodeURIComponent(rpstMovieNo)}`,
                releaseDate,
                theaterBrandName: 'Megabox'
            }
        })).filter(x => x);
    }], callback);
};

const getKRMovies = (option, callback) => async.waterfall([
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
    getKRMovies: getKRMovies
};
