import axios from 'axios';

export async function getAIResponse(userInput) {
  try {
    if (!userInput || userInput.trim() === '') {
      throw new Error('Empty user input');
    }

    console.log('Sending request with input:', userInput);

    const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/aramid-chat', {
      userInput: userInput,
      context: 'discord-chat',
      type: 'general'
    });

    console.log('API Response:', JSON.stringify(response.data, null, 2));

    // Handle the agents array response format
    if (response.data && response.data.agents && Array.isArray(response.data.agents)) {
      const aramidAgent = response.data.agents.find(agent => agent.name === 'Aramid');
      if (aramidAgent && aramidAgent.response) {
        return aramidAgent.response;
      }
    }

    throw new Error('Invalid response format from API');
  } catch (error) {
    console.error('Error getting AI response:', error.response?.data || error.message);
    throw new Error('Failed to get AI response');
  }
}
