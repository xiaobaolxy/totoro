'use strict';

var inherits = require('util').inherits
var express = require('express')
var path = require('path')
var fs = require('fs')
var http = require('http')
var io = require('socket.io-client')
var common = require('totoro-common')
var colorful = require('colorful')

var logger = require('./logger')
var handleCfg = require('./handle-cfg')
var report = require('./report')
var getRepo = require('./get-repo')

var startTime


module.exports = Client


function Client(cfg) {
    startTime = new Date().getTime()

    var that = this
    this.cfg = handleCfg(cfg)
    this.labors = {}

    var browsers = cfg.browsrs
    browsers && browsers.forEach(function(browser) {
        that.labors[browser] = undefined
    })

    this.report = cfg.report || report

    if (cfg.clientRoot) {
        this.launchServer(function() {
            that.launchTest()
        })
    } else {
        this.launchTest()
    }
}

Client.prototype.launchServer = function(callback) {
    var that = this
    var cfg = this.cfg
    var clientRoot = cfg.clientRoot

    process.chdir(clientRoot)

    var app = express()
    app.use(express.static(clientRoot))

    app.listen(cfg.clientPort, cfg.clientHost, function() {
        logger.debug('Start client server<' + cfg.clientHost + ':' + cfg.clientPort + '>')
        callback()

    }).on('error', function(e) {
        if (e.code === 'EADDRINUSE') {
            logger.debug('Port %d is in use, will auto find another one.', cfg.clientPort)
            cfg.clientPort = randomPort()
            that.launchServer(callback)
        } else {
            throw e
        }
    })
}

Client.prototype.launchTest = function() {
    var that = this
    var cfg = this.cfg
    var socket = this.socket = io.connect(
            'http://' + cfg.serverHost + ':' + cfg.serverPort + '/order')

    socket.on('connect', function () {
        var pkgFile = path.join(__dirname, '..', 'package.json')
        var version = JSON.parse(fs.readFileSync(pkgFile)).version

        getRepo(cfg.runner, function(repo) {
            logger.debug('Found repo<' + repo + '>')
            logger.debug('Client duration<' + (new Date().getTime() - startTime)+ 'ms>')

            socket.emit('init', {
                runner: cfg.runner,
                adapter: cfg.adapter,
                clientHost: cfg.clientHost,
                clientPort: cfg.clientPort,
                charset: cfg.charset,
                browsers: cfg.browsers,
                version: version,
                repo: repo
            })
        })

        this.timer = setTimeout(function() {
            if (that.isPrinting) {
                logger.warn('Client timeout when printing results, let it go.')
                clearTimeout(that.timer)
            } else {
                logger.warn('Client timeout, will print results and then exit.')
                that.report(that.labors)
                that.destroy()
            }
        }, cfg.timeout * 60 * 1000)
    })

    socket.on('report', function(reports) {
        var labors = that.labors

        reports.forEach(function(report) {
            var action = report.action
            var browser = report.browser
            if (browser) {
                var labor = labors[browser]
            }
            var info = report.info

            switch (action) {
                case 'log':
                    logger[info.type](info.message)
                    break
                case 'add':
                    var id = info.laborId
                    var ua = info.ua
                    labors[browser] = {
                        id: id,
                        ua: ua,
                        passes: [],
                        pending: [],
                        failures: [],
                        stats: undefined
                    }
                    logger.debug('Add labor<' + id + '>, UA<' + ua + '>')
                    break
                case 'remove':
                    labors[browser] = undefined
                    logger.debug('Remove labor<' + labor.id + '>')
                    break
                case 'pass':
                    labor.passes.push(info)
                    print('.', 'green')
                    break
                case 'pending':
                    labor.pending.push(info)
                    print('.', 'cyan')
                    break
                case 'fail':
                    labor.failures.push(info)
                    print('×', 'red')
                    break
                case 'end':
                    labor.stats = info
                    break
                case 'endAll':
                    that.isPrinting = true
                    that.report(labors)
                    that.isPrinting = false
                    that.destroy()
                    break
                case 'browsers':
                    info.forEach(function(browser) {
                        labors[browser] = undefined
                    })
                    break
                default:
                    logger.warn('Not realized report action<' + action + '>')
                    break
            }
        })
    })

    socket.on('proxyReq', function(info) {
        var opts = {
            hostname: cfg.clientHost,
            port: cfg.clientPort,
            path: info.path,
            headers: info.headers
        }

        http.request(opts, function(res) {
            var buffer = new Buffer(parseInt(res.headers['content-length'], 10))
            var offset = 0

            res.on('data', function(data) {
                data.copy(buffer, offset)
                offset += data.length
            })

            res.on('end', function() {
                socket.emit('proxyRes', {
                    path: info.path,
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: buffer
                })
            })

        }).on('error', function(err) {
            logger.warn('Proxy resource error<' + err + '>')
            socket.emit('proxyRes', {
                path: info.path,
                statusCode: 500,
                body: err
            })

        }).end()
    })

    socket.on('error', function() {
        logger.error('Server is not available, please check your config or try again later.')
    })

    socket.on('disconnect', function() {
        logger.error('Server is interrupted, please try again later.')
    })

}

Client.prototype.destroy = function() {
    process.exit(0)
}


function print(str, c) {
    str = str || ''
    str = c ? colorful[c](str) : str
    process.stdout.write(str)
}


function randomPort() {
    return Math.floor(Math.random() * 1000) + 7000
}

