#!/usr/bin/env node
'use strict';

const port = (() => {
    const args = process.argv;

    if (args.length !== 3) {
        console.error("usage: node index.js port");
        process.exit(1);
    }

    const num = parseInt(args[2], 10);
    if (isNaN(num)) {
        console.error("error: argument must be an integer.");
        process.exit(1);
    }

    return num;
})();

const express = require("express");
const app = express();
require("dotenv").config();

app.use(express.json());

// ADD YOUR WORK HERE

// Import routers
const authRouter = require("./src/routes/auth.js");
const userRouter = require("./src/routes/users.js");



// Mount routers
app.use("/auth", authRouter);
app.use("/users", userRouter);




// keep this at the end
const { notFound, errorHandler } = require("./src/middleware/errorHandler");
app.use(notFound);
app.use(errorHandler);
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

server.on('error', (err) => {
    console.error(`cannot start server: ${err.message}`);
    process.exit(1);
});