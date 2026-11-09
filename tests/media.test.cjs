const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadExtension() {
  const context = vm.createContext({ URL });
  function load(file) {
    vm.runInContext(readFileSync(new URL(`../extension/${file}`, baseUrl), "utf8"), context);
  }
  const baseUrl = require("node:url").pathToFileURL(__filename);
  return { context, load, evaluate: (expression) => vm.runInContext(expression, context) };
}

const photo = { type: "photo", media_url_https: "https://pbs.twimg.com/media/Picture.png" };
const video = {
  type: "video",
  video_info: {
    variants: [
      { content_type: "video/mp4", bitrate: 256000, url: "https://video.twimg.com/ext_tw_video/1/low.mp4" },
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/ext_tw_video/1/master.m3u8" },
      { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/ext_tw_video/1/high.mp4" },
    ],
  },
};

test("keeps each post's attachments separate and chooses orig photos and highest-bitrate MP4", () => {
  const { context, load, evaluate } = loadExtension();
  const quoted = { rest_id: "456", legacy: { extended_entities: { media: [photo] } } };
  const tweet = {
    rest_id: "123",
    legacy: { extended_entities: { media: [video, { ...photo, media_url_https: "https://pbs.twimg.com/media/Own.jpg" }] } },
    quoted_status_result: { result: quoted },
  };
  context.response = { data: { tweetResult: { result: { __typename: "TweetWithVisibilityResults", tweet } } } };
  load("media.js");
  const result = JSON.parse(evaluate("JSON.stringify(tweetMedia.fromResponse(response))"));
  assert.deepEqual(result, [
    { id: "123", urls: [
      "https://video.twimg.com/ext_tw_video/1/high.mp4",
      "https://pbs.twimg.com/media/Own?format=jpg&name=orig",
    ] },
    { id: "456", urls: ["https://pbs.twimg.com/media/Picture?format=png&name=orig"] },
  ]);
});

test("selects the GIF's MP4 and records a video with no downloadable MP4 as unavailable", () => {
  const { context, load, evaluate } = loadExtension();
  const playlist = video.video_info.variants[1];
  context.response = {
    data: {
      result: {
        rest_id: "123",
        legacy: { extended_entities: { media: [
          { type: "animated_gif", video_info: { variants: [
            { content_type: "video/mp4", url: "https://video.twimg.com/tweet_video/Gif.mp4" },
          ] } },
          { type: "video", video_info: { variants: [playlist] } },
        ] } },
      },
    },
  };
  load("media.js");
  assert.deepEqual(JSON.parse(evaluate("JSON.stringify(tweetMedia.fromResponse(response))")), [
    { id: "123", urls: ["https://video.twimg.com/tweet_video/Gif.mp4", null] },
  ]);
});

test("normalizes rendered photos and rejects thumbnails and untrusted domains", () => {
  const { load, evaluate } = loadExtension();
  load("media.js");
  assert.equal(
    evaluate('tweetMedia.originalPhoto("https://pbs.twimg.com/media/Photo?format=jpg&name=small")'),
    "https://pbs.twimg.com/media/Photo?format=jpg&name=orig",
  );
  assert.equal(evaluate('tweetMedia.originalPhoto("https://pbs.twimg.com/media/Photo.png:large")'),
    "https://pbs.twimg.com/media/Photo?format=png&name=orig");
  assert.equal(evaluate('tweetMedia.originalPhoto("https://pbs.twimg.com/ext_tw_video_thumb/123/poster.jpg")'), null);
  assert.equal(evaluate('tweetMedia.originalPhoto("https://pbs.twimg.com.example.org/media/Photo.jpg")'), null);
});

test("queues each allowed file once and reports a partial failure", async () => {
  const { context, load } = loadExtension();
  const requested = [];
  let receive;
  context.importScripts = load;
  context.chrome = {
    runtime: { onMessage: { addListener: (listener) => { receive = listener; } } },
    downloads: {
      async download(options) {
        requested.push(options);
        if (options.url.endsWith(".mp4")) throw new Error("Download blocked");
        return 1;
      },
    },
  };
  load("background.js");
  const message = {
    type: "download-tweet-media", id: "123", urls: [
      "https://pbs.twimg.com/media/Own?format=jpg&name=orig",
      "https://video.twimg.com/ext_tw_video/1/high.mp4",
      "https://pbs.twimg.com/media/Own?format=jpg&name=orig",
      "https://example.org/untrusted.mp4",
    ],
  };
  assert.equal(receive(message, { url: "https://example.org/" }, assert.fail), undefined);
  const result = await new Promise((resolve) => {
    assert.equal(receive(message, { url: "https://x.com/user/status/123" }, resolve), true);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { queued: 1, failed: 2 });
  assert.deepEqual(requested.map(({ filename }) => filename), ["123-1.jpg", "123-2.mp4"]);
});
