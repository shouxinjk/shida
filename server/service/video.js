/* eslint-disable no-case-declarations */
const path = require('path');
const savePath = require('../../server/config/index');//下载的在线视频存放路径
const fs = require('fs-extra');
const {isEmpty, forEach} = require('lodash');
const {FFRect, FFScene, FFImage, FFText, FFGifImage, FFVideo, FFAlbum, FFCreator} = require('ffcreator');
const ffmpeg = require('fluent-ffmpeg');
const {scaleVideoByCenter} = require("../../utils/crop");

const FFLottie = require('ffcreator/lib/node/lottie');//获取Lottie对象 2024-10-08新增代码
const axios = require('axios'); 

const fontRootPath = path.join(__dirname, '../public/static/fonts/');

//字体判断
function walk(path, it) {
  const dirList = fs.readdirSync(path);
  for (let fontFile of dirList) {
    if (fontFile.indexOf(it) !== -1) {
      return fontFile;
    }
  }
}

//图片预加载处理（重要）
async function preloadImage(imageUrl) {  
  try {  
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });  
    const imageBuffer = Buffer.from(response.data, 'binary');
    console.log(`Image preloaded: ${imageUrl}`);
    return imageBuffer;
  } catch (error) {  
    console.error(`Failed to preload image: ${imageUrl}`, error);  
  }  
}

// 添加对应类型组件
const addComponent = async element => {
  let comp, url;
  const {left = 0, top = 0, width, height} = element.commonStyle || {};
  let style = element.commonStyle;
  const x = left + width / 2;
  const y = top + height / 2;
  const commomStyle = {x, y, width, height, style};

  const getNetPath = url => {
    if (/^(http|https|www)/gi.test(url)) return url;
    if (/^(\/static|\\static)/gi.test(url)) return path.join(__dirname, '../public', url);
    if (/^(\/resource|\\resource)/gi.test(url)) return path.join(__dirname, '../public', url);
    return url;
  };

  //todo 图片视频问题
  const getImgPath = propsValue => {
    const {localPath, imageSrc} = propsValue;
    if (localPath) return localPath;
    return getNetPath(imageSrc);
  };
  //

  switch (element.elName) {
    case 'qk-image':
      url = getImgPath(element.propsValue);
      console.log("...commomStyle",commomStyle)
      // console.log("url",url)
      // url = path.join(__dirname, '../public', element.propsValue.imageSrc)
      const imgExt = path.extname(url).split('.').pop()
      console.log("imgExt",imgExt)
      if (imgExt === 'GIF' || imgExt === 'gif') {
        // if (process.env.NODE_ENV !== 'dev' && process.env.NODE_ENV !== 'production') {
        //   url = path.join(__dirname, '../public', url)
        // }
        comp = new FFGifImage({path: url, ...commomStyle})
      }else if (imgExt === 'json') {//判断是否是lottie动画类型
        const fetch = await import('node-fetch');
        const resp = await fetch.default(element.propsValue.imageSrc);//用于读取lottie json数据
        const json = await resp.json();
        comp = new FFLottie({
          data: json,...commomStyle
        })
        let assets = element.propsValue.replaceAssets;
        let texts = element.propsValue.replaceTexts;
        for (const asset of assets) {
          const path = await preloadImage(asset.path);
          await comp.replaceAsset(asset.id,path,true);
        }
        for (const text of texts) {
          await comp.replaceText(text.target,text.txt);
        }
      }else {
        comp = new FFImage({path: url, ...commomStyle})
        if(commomStyle.style.opacity){
          comp.setOpacity(commomStyle.style.opacity);
        }
      }
      break;

    case 'qk-rectangle-border':
      const color = element.propsValue.bgColor;
      comp = new FFRect({color, ...commomStyle});
      break;

    case 'qk-text':
      const text = element.propsValue.text;
      const fontName = element.propsValue.font.split('/')[1];
      const fontFile = fontRootPath + walk(fontRootPath, fontName);
      comp = new FFText({text, ...commomStyle});
      comp.setStyle(element.commonStyle);
      if(fs.pathExistsSync(fontFile)){
        comp.setFont(fontFile);
      }else {
        comp.setFont('../public/static/demo/wryh.ttf');
      }
      comp.setAnchor(1);
      comp.alignCenter();
      break;

    case 'qk-video':
      url = getNetPath(element.propsValue.videoSrc);
      console.log("video url",url)
      // url = path.join(__dirname, '../public', element.propsValue.videoSrc)
      let videoUrlCropped = ''
      // videoUrlCropped = `G:\\video\\videos\\tmpVideo_`+new Date().getTime()+`.${path.basename(url).split('.').pop()}`;//本地测试
      videoUrlCropped = `${savePath.tmpVideoDir}/tmpVideo_`+new Date().getTime()+`.${path.basename(url).split('.').pop()}`;
      // videoUrlCropped = `${path.dirname(url)}/${path.basename(url).split('.')
      //   .shift()}_handled.${path.basename(url).split('.').pop()}`;//原项目代码
      await scaleVideoByCenter(url, commomStyle.width, commomStyle.height, videoUrlCropped);
      if (videoUrlCropped) {
        url = videoUrlCropped;
      }
      comp = new FFVideo({path: url, ...commomStyle});
      if(commomStyle.style.opacity){
        comp.setOpacity(commomStyle.style.opacity);
      }
      break;

    case 'qk-image-carousel':
      // console.log("carousel")
      const list = element.propsValue.imageSrcList.map(x => getImgPath({imageSrc: x}));
      comp = new FFAlbum({list, showCover: true, ...commomStyle});
      comp.setTransition('zoomIn');
      comp.setDuration(element.propsValue.interval);
      comp.setTransTime(1.5)
      break;
  }

  if (!isEmpty(element.animations)) {
    forEach(element.animations, ani => {
      const {type, duration = 1, delay = 1} = ani;
      comp.addEffect(type, duration, delay);
    });
  }
  // console.log(comp)
  return comp;
};

const cleanCacheFolder = async folderId => {
  const cacheDir = path.join(__dirname, '../public/resource/images', `${folderId}`);
  await fs.emptyDir(cacheDir);
  await fs.remove(cacheDir);
};

/**
 *  生成视频的第一帧图片
 * @param {string} inputVideo 输入视频文件路径
 * @param {string} saveDir 截图保存路径
 * @param {string} fileName 截图名
 * @returns 封装ffmpeg的Promise对象
 */
async function getVideoScreenshot(inputVideo, saveDir, fileName) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputVideo)
      .withFrames(1)
      .takeScreenshots({
        count: 1,
        // timemarks: ['1'], // number of seconds
        filename: fileName,
      }, saveDir)
      .on('end', () => {
        // console.log('getVideoScreenshot.completed');
        resolve('completed');
      })
      .on('error', (err) => {
        // console.log(`getVideoScreenshot.error: ${err.message}`);
        reject(new Error(`error:${err.message}`));
      });
  });
}


// 服务类
module.exports = app => ({
  async createFFTask({videoData, folderId, uuid}, id) {
    const {ctx, $model} = app;
    const {width, height, fps, audio} = videoData;
    const outputDir = path.join(__dirname, '../public/resource/videos', id)
    const cacheDir = path.join(__dirname, '../cache/', id)
    const localAudio = audio ? path.join(__dirname, '../public', audio) : null;

    const creator = new FFCreator({
      cacheDir,
      outputDir,
      width,
      height,
      fps,
      audio: localAudio,
      debug: false,
      parallel: 8,
    });

    for (let i = 0; i < videoData.pages.length; i++) {
      const page = videoData.pages[i];
      const {duration, transDuration, trans, backgroundColor} = page.data;

      const scene = new FFScene();
      scene.setBgColor(backgroundColor);
      scene.setDuration(duration);
      scene.setTransition(trans, transDuration);
      creator.addChild(scene);

      for (let j = 0; j < page.elements.length; j++) {
        const element = page.elements[j];
        const comp = await addComponent(element);
        if (comp) scene.addChild(comp);
      }
    }
    creator.start();
    //creator.openLog();

    let videoDB;
    let index = 0;
    creator.on('start', () => {
      console.log(`FFCreator start`);
      videoDB = $model.video.create({uuid});
    });

    creator.on('error', e => {
      cleanCacheFolder(folderId);
      console.log(`FFCreator error: ${e.error}`);
    });

    creator.on('progress', e => {
      const percent = (e.percent * 100) >> 0;
      if (index % 3 === 0) {
        const {_id} = videoDB;
        $model.video.updateOne({_id}, {$set: {percent}});
      }

      console.log(`FFCreator progress: ${percent}%`);
      index++;
    });

    creator.on('complete', e => {
      cleanCacheFolder(folderId);
      const {_id} = videoDB;
      const file = e.output;
      const videoFileName = e.output.replace(outputDir, '');
      getVideoScreenshot(e.output, outputDir, videoFileName.replace('mp4', 'jpg'));
      $model.video.updateOne({_id}, {$set: {state: 'complete', file}});
      console.log(`FFCreator completed: \n USEAGE: ${e.useage} \n PATH: ${file} `);
    });

    return creator;
  },
});
