import Constants from 'expo-constants';
import {
  getPermissionsAsync,
  requestPermissionsAsync,
  saveToLibraryAsync,
} from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export { wishAchievementSaveErrorMessage } from '@/lib/wish-achievement-save-messages';

export type WishAchievementSaveResult = 'saved' | 'shared';

export async function requestWishAchievementSavePermission(): Promise<
  'granted' | 'denied'
> {
  const current = await getPermissionsAsync(true);
  if (current.granted) return 'granted';
  const requested = await requestPermissionsAsync(true);
  return requested.granted ? 'granted' : 'denied';
}

async function shareWishAchievementImage(uri: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('当前环境无法保存或分享图片');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
  });
}

/** Prefer album save; fall back to system share in Expo Go / on failure. */
export async function saveWishAchievementImage(
  uri: string,
): Promise<WishAchievementSaveResult> {
  if (Platform.OS === 'web') {
    const link = document.createElement('a');
    link.href = uri;
    link.download = `worth-wish-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'saved';
  }

  const inExpoGo = Constants.appOwnership === 'expo';

  if (!inExpoGo) {
    const permission = await requestWishAchievementSavePermission();
    if (permission === 'denied') {
      throw new Error('需要相册权限才能保存，请在设置中开启');
    }
    await saveToLibraryAsync(uri);
    return 'saved';
  }

  try {
    const permission = await requestWishAchievementSavePermission();
    if (permission === 'granted') {
      await saveToLibraryAsync(uri);
      return 'saved';
    }
  } catch {
    // Expo Go on Android often cannot write the library; share instead.
  }

  await shareWishAchievementImage(uri);
  return 'shared';
}
