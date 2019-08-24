/* eslint-disable */
const path = require("path");
const nodemon = require("nodemon");
const webpack = require("webpack");
const chalk = require("chalk");
const tcpPortUsed = require("tcp-port-used");
const listPackages = require("../utils/listPackages");
const logFunctions = require("./logFunctions");

function normalizePath(raw) {
    raw = raw.trim();
    if (raw.includes(" ")) {
        return `"${raw}"`;
    }
    return raw;
}

module.exports = async ({ port, watch, inspect }) => {
    watch = Array.isArray(watch) ? watch : [watch];

    const command = [normalizePath(path.join(__dirname, "runFunctions.js"))];

    const functions = await listPackages("function");
    let watchPaths = functions.map(fn => fn.root + "/build/**/*.js");

    watch.filter(Boolean).forEach(w => {
        watchPaths.push(path.resolve(w));
    });

    watchPaths.forEach(item => command.unshift(`-w ${normalizePath(item)}`));

    // "--port" argument:
    command.push(`--port=${port}`);

    // "--inspect" argument
    if (inspect) {
        command.unshift(`--inspect=${inspect}`);
    }

    // Check port:
    tcpPortUsed.check(port).then(async inUse => {
        if (inUse) {
            console.log(chalk.red(`Port ${port} already in use.`));
            process.exit(1);
        }

        logFunctions(functions);

        const configs = functions.map(fn => require(fn.root + "/webpack.config.js"));

        const compiler = webpack(configs);
        console.log("Building functions...");

        let firstRun = true;
        compiler.watch(
            {
                aggregateTimeout: 300,
                poll: 1000
            },
            () => {
                if (!firstRun) {
                    return;
                }

                firstRun = false;

                nodemon(command.join(" "))
                    .on("quit", process.exit)
                    .on("restart", function() {
                        console.log(chalk.green("Restarting..."));
                    });
            }
        );
    });
};