# Aramid-AI-X

Aramid-AI-X is a Twitter bot designed to automatically post and respond to tweets using AI-generated content. It leverages the SmallTimeDevs API built on the Aramid-Hive-Engine to generate engaging and professional responses.

## Features

- Automatically post tweets based on token data.
- Respond to tweets with AI-generated content.
- Utilize the SmallTimeDevs API for AI-generated responses.
- Rate limit handling to avoid exceeding Twitter API limits.

## Prerequisites

- Node.js (version 14 or higher)
- Twitter API credentials
- SmallTimeDevs API credentials

## Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/Small-Time-Devs/Aramid-AI-X.git
    cd Aramid-AI-X
    ```

2. Install the dependencies:

    ```bash
    npm install
    ```

3. Create a `.env` file in the root directory and fill it with your Twitter API credentials and SmallTimeDevs API credentials. Use the `.env.example` file as a template.

    ```bash
    cp .env.example .env
    ```

4. Update the `config.mjs` file with your specific configuration settings.

## Usage

1. Start the server:

    ```bash
    npm start
    ```

2. The bot will automatically start posting tweets and responding to tweets based on the configuration settings.

## Configuration

The configuration settings are located in the `src/config/config.mjs` file. You can customize the following settings:

- `twitter.keys`: Your Twitter API credentials.
- `twitter.settings`: Settings for auto-posting and auto-responding.
- `twitter.influencers`: List of Twitter handles to tag in the tweets.
- `twitter.solanaProjectsToReveiw`: List of Solana project contract addresses to review.
- `apis`: API endpoints for fetching token data and other information.

## How It Works

### Auto-Posting Tweets

The `autoPostToTwitter` function in the `index.mjs` file is responsible for automatically posting tweets. It generates tweets based on token data and posts them to Twitter using the Twitter API.

### Responding to Tweets

The `scanAndRespondToPosts` function in the `index.mjs` file scans for tweets and responds to them using AI-generated content. It uses the SmallTimeDevs API to generate the responses.

### SmallTimeDevs API

The SmallTimeDevs API, built on the Aramid-Hive-Engine, is used to generate AI responses. The API endpoints are configured in the `config.mjs` file. The bot sends requests to the API with the necessary prompts and receives AI-generated responses.

For more information on the SmallTimeDevs API and the Aramid-Hive-Engine, visit the [Aramid-Hive-Engine GitHub repository](https://github.com/Small-Time-Devs/Aramid-Hive-Engine).

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.