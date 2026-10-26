/** The simulated apps by id (the shell renders each open app's screen stack with these). */
import type { ComponentType } from 'react';
import type { PhoneAppId } from '@shared/phone';
import type { Screen } from '../runtime';
import { RailApp } from './RailApp';
import { RideApp } from './RideApp';
import { FoodApp } from './FoodApp';
import { MovieApp } from './MovieApp';
import { DineApp } from './DineApp';
import { ChatApp } from './ChatApp';
import { SmsApp, WalletApp } from './SystemApps';

export const APP_COMPONENTS: Record<PhoneAppId, ComponentType<{ screen: Screen }>> = {
  rail: RailApp,
  ride: RideApp,
  food: FoodApp,
  movie: MovieApp,
  dine: DineApp,
  chat: ChatApp,
  wallet: WalletApp,
  sms: SmsApp,
};
