import * as twitterProfessional from "./src/agent.mjs";
import { config } from './src/config/config.mjs';
import { checkRateLimit } from './src/utils/helpers.mjs';
import { TwitterApi } from "twitter-api-v2";


function autoPostToTwitter() {
  if (!config.twitter.settings.xAutoPoster) return;

  const maxPostsPerMonth = config.twitter.settings.postsPerMonth;
  const postsPerDay = config.twitter.settings.postsPerDay;
  const maxPostsPerDay = Math.min(postsPerDay, Math.floor(maxPostsPerMonth / 30));
  const maxTweetsPerDay = Math.floor(maxPostsPerDay / 3); // Each post is 3 tweets (tweet, comment, hashtags)
  const interval = 24 * 60 * 60 * 1000 / maxTweetsPerDay; // Interval in milliseconds

  const client = new TwitterApi({
    appKey: `${config.twitter.keys.appKey}`,
    appSecret: `${config.twitter.keys.appSecret}`,
    accessToken: `${config.twitter.keys.accessToken}`,
    accessSecret: `${config.twitter.keys.accessSecret}`,
  });

  for (let i = 0; i < maxTweetsPerDay; i++) {
    setTimeout(async () => {
      try {
        const canPost = await checkRateLimit(client);
        if (!canPost) {
          console.log('Skipping post due to rate limit.');
          return;
        }

        // step 1 call the generateAutoPostTweet function from the twitterProfessional module
        const tweet = await twitterProfessional.generateAutoPostTweet();
        if (config.twitter.settings.devMode) {
          console.log(`Dev mode enabled, 
            Tweet to be sent!. ${tweet.tweet}
            Comment: ${tweet.comment}
            Hashtags: ${tweet.hashtagsComment}`);
          return;
        }

        if (tweet === undefined) {
            console.log("Tweet is undefined, generating a new one!");
            const tweet = await twitterProfessional.generateAutoPostTweet();
        }
        await twitterProfessional.postToTwitter(tweet, client);
      } catch (error) {
        console.error("Error auto-posting to Twitter:", error);
      }
    }, i * interval);
  }
}

function scanAndRespondToTwitterPosts() {
  if (!config.twitter.settings.xAutoResponder) return; // Ensure the function respects the xAutoResponder flag

  const interval = config.twitter.settings.timeToReadPostsOnPage * 60 * 1000; // Interval in milliseconds

  setInterval(async () => {
    try {
      await twitterProfessional.scanAndRespondToPosts();
    } catch (error) {
      console.error("Error scanning and responding to Twitter posts:", error);
    }
  }, interval);
}

autoPostToTwitter();