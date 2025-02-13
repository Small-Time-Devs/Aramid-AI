import axios from 'axios';

export async function getAIResponse(userInput) {
  try {
    if (!userInput || userInput.trim() === '') {
      throw new Error('Empty user input');
    }

    const response = await axios.post('https://api.smalltimedevs.com/ai/hive-engine/aramid-chat', {
      userInput: userInput,
      context: 'discord-chat',
      type: 'general'
    });

    // Add debug logging
    console.log('API Response:', JSON.stringify(response.data, null, 2));

    // Check if response.data is directly the array we need
    const responseData = response.data;
    
    if (Array.isArray(responseData) && responseData.length > 0) {
      const aramidResponse = responseData.find(agent => agent.name === 'Aramid');
      if (aramidResponse?.response) {
        return aramidResponse.response;
      }
    } else if (responseData?.agents) {
      // Alternative format where response might be nested under 'agents'
      const aramidResponse = responseData.agents.find(agent => agent.name === 'Aramid');
      if (aramidResponse?.response) {
        return aramidResponse.response;
      }
    }

    console.error('Unexpected response format:', responseData);
    throw new Error('Invalid response format from API');
  } catch (error) {
    console.error('Error getting AI response:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Full error response:', JSON.stringify(error.response.data, null, 2));
    }
    throw new Error(error.response?.data?.error || 'Failed to get AI response');
  }
}
