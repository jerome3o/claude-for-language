export interface Situation {
  id: string;
  title: string;
  scenario: string;
  user_role: string;
  ai_role: string;
  goal: string;
}

export const SITUATIONS: Situation[] = [
  {
    id: 'hotel-checkin',
    title: 'Checking into a hotel',
    scenario:
      'You arrive at a mid-range hotel in Shanghai in the evening with a reservation under your name.',
    user_role: 'a foreign traveller checking in',
    ai_role: 'the hotel front-desk receptionist',
    goal: 'Get your room key, confirm the wifi password, and ask what time breakfast is.',
  },
  {
    id: 'restaurant-order',
    title: 'Ordering at a restaurant',
    scenario: 'You sit down at a small local restaurant. The waiter brings a menu.',
    user_role: 'a customer',
    ai_role: 'the waiter',
    goal: 'Order two dishes and a drink, ask if one dish is spicy, and ask for the bill.',
  },
  {
    id: 'directions',
    title: 'Asking for directions',
    scenario: 'You are on a street corner trying to find the nearest subway station.',
    user_role: 'a lost tourist',
    ai_role: 'a friendly passer-by',
    goal: 'Find out which direction the subway is and roughly how far.',
  },
  {
    id: 'train-ticket',
    title: 'Buying a train ticket',
    scenario: 'You are at a railway station ticket counter.',
    user_role: 'a traveller',
    ai_role: 'the ticket clerk',
    goal: 'Buy one second-class ticket to Beijing for tomorrow morning.',
  },
  {
    id: 'taxi',
    title: 'Taking a taxi',
    scenario: 'You get into a taxi outside the airport.',
    user_role: 'a passenger',
    ai_role: 'the taxi driver',
    goal: 'Tell the driver your hotel address, ask roughly how long it will take, and pay at the end.',
  },
  {
    id: 'pharmacy',
    title: 'At the pharmacy',
    scenario: 'You have a headache and walk into a pharmacy.',
    user_role: 'a customer who feels unwell',
    ai_role: 'the pharmacist',
    goal: 'Explain your symptom, get a recommendation, and ask how often to take it.',
  },
  {
    id: 'market-haggle',
    title: 'Haggling at a market',
    scenario: 'You are at an outdoor market looking at a jacket you like.',
    user_role: 'a shopper',
    ai_role: 'the market stall vendor',
    goal: 'Ask the price, say it is too expensive, and agree on a lower price.',
  },
  {
    id: 'coffee-shop',
    title: 'Ordering coffee',
    scenario: 'You walk into a busy coffee shop.',
    user_role: 'a customer',
    ai_role: 'the barista',
    goal: 'Order an iced latte to take away and pay by phone.',
  },
  {
    id: 'neighbor-smalltalk',
    title: 'Small talk with a neighbour',
    scenario: 'You bump into your neighbour in the building elevator.',
    user_role: 'a new resident',
    ai_role: 'a chatty older neighbour',
    goal: 'Exchange greetings, answer where you are from, and say something about the weather.',
  },
  {
    id: 'phone-shop',
    title: 'Getting a SIM card',
    scenario: 'You are at a mobile phone shop and need a local SIM card.',
    user_role: 'a new arrival',
    ai_role: 'the shop assistant',
    goal: 'Ask for a SIM with data, find out the monthly cost, and hand over your passport.',
  },
  {
    id: 'doctor-visit',
    title: 'Visiting a doctor',
    scenario: 'You are at a clinic because you have had a cough for a few days.',
    user_role: 'a patient',
    ai_role: 'the doctor',
    goal: 'Describe how long you have been coughing and whether you have a fever.',
  },
  {
    id: 'bubble-tea',
    title: 'Ordering bubble tea',
    scenario: 'You are at a bubble tea counter with a long menu.',
    user_role: 'a customer',
    ai_role: 'the cashier',
    goal: 'Order a milk tea, choose sugar and ice level, and pay.',
  },
];

export function getSituation(id: string): Situation | undefined {
  return SITUATIONS.find((s) => s.id === id);
}

export function getTodaySituation(date = new Date()): Situation {
  const day = Math.floor(date.getTime() / 86400000);
  return SITUATIONS[day % SITUATIONS.length];
}
