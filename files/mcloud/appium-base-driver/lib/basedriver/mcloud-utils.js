import fs from 'appium-support/build/lib/fs';
import nodePath from 'path';
import axios from 'axios';
import path from 'path';
import logger from './logger';
import { exec } from 'child_process';

async function getLocalAppsFolder() {
    return process.env.APPIUM_APPS_DIR;
}

async function getSharedFolderForAppUrl(url) {
    const sub = await getLocalFileForAppUrl(url);

    const lastSlashInd = sub.lastIndexOf(path.sep);
    var targetPath;
    if(lastSlashInd != -1) {
        targetPath = sub.substring(0, lastSlashInd);
    } else {
        targetPath = '';
    }

    logger.info(`Target path [getSharedFolderForAppUrl]: ${targetPath}`)
    const folderExists = await fs.exists(targetPath);
    if(!folderExists)
        await fs.mkdir(targetPath, {recursive : true});
  
    return targetPath;
}

async function getLocalFileForAppUrl(url) {
    var sub = url.substring(url.indexOf('//') + 2)
    sub = sub.substring(sub.indexOf('/'));
    if(sub.includes('?')) {
        sub = sub.substring(0, sub.indexOf('?'));
    }
    sub = sub.replace(/\//g, path.sep);

    const targetPath = nodePath.join(await getLocalAppsFolder(), sub);
    logger.info(`Target path [getLocalFileForAppUrl]: ${targetPath}`)
    return targetPath;
}

async function getFileContentLength(remoteUrl) {
    const timeout = 5000;
    const requestOpts = {
        url: remoteUrl,
        responseType: 'stream',
        timeout,
    };

    try {
        const {
          headers: responseHeaders,
        } = await axios(requestOpts);
        const responseLength = parseInt(responseHeaders['content-length'], 10);
        logger.info("!!CONTENT-LENGTH: " + responseLength);
        return responseLength;
    } catch (err) {
        throw new Error(`Cannot get file content-length from ${remoteUrl}: ${err.message}`);
    }
}

function executeShell(shellCommand, description) {
    exec(shellCommand, (error, stdout, stderr) => {
        if (error) {
            logger.info(`${description} error: ${error.message}`);
            return;
        }
        if (stderr) {
            logger.info(`${description} stderr: ${stderr}`);
            return;
        }
        logger.info(`${description} command was successfully executed`);
      });
}


module.exports = { getLocalAppsFolder, getSharedFolderForAppUrl, getLocalFileForAppUrl, getFileContentLength, executeShell }