import {
  Asset,
  getPermissionsAsync,
  requestPermissionsAsync,
} from 'expo-media-library';

export { wishAchievementSaveErrorMessage } from '@/lib/wish-achievement-save-messages';

export async function requestWishAchievementSavePermission(): Promise<
  'granted' | 'denied'
> {
  const current = await getPermissionsAsync(true);
  if (current.granted) return 'granted';
  const requested = await requestPermissionsAsync(true);
  return requested.granted ? 'granted' : 'denied';
}

export async function saveWishAchievementImage(uri: string): Promise<void> {
  await Asset.create(uri);
}
