import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from 'react-native';

import { colors } from '@/constants/colors';
import { analyzePhoto } from '@/lib/api';
import { removePhoto, uploadPhoto } from '@/lib/assets';
import { useDraft } from '@/providers/draft-provider';
import { useSession } from '@/providers/session-provider';

export default function CaptureScreen() {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { session } = useSession();
  const { setDraft } = useDraft();

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, []),
  );

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const takePhoto = async () => {
    if (!camera.current || !ready || !session) return;
    setLoading(true);
    setError('');
    let uploadedPath = '';
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });
      if (!photo.base64) throw new Error('无法读取照片');
      const uploaded = await uploadPhoto(photo.base64, session.user.id);
      uploadedPath = uploaded.path;
      const recognition = await analyzePhoto(uploaded.signedUrl);
      setDraft({
        localUri: photo.uri,
        photoPath: uploaded.path,
        recognition,
      });
      router.push('/confirm');
    } catch (caught) {
      if (uploadedPath) await removePhoto(uploadedPath).catch(() => undefined);
      setError(
        caught instanceof Error ? caught.message : '识别失败，请重新拍摄',
      );
    } finally {
      setLoading(false);
    }
  };

  if (!permission?.granted) {
    return (
      <>
        <Stack.Screen options={{ title: '拍照录入' }} />
        <View
          style={{
            flex: 1,
            padding: 24,
            justifyContent: 'center',
            alignItems: 'center',
            gap: 16,
            backgroundColor: colors.background,
          }}>
          <Text selectable style={{ color: colors.text, textAlign: 'center' }}>
            需要相机权限才能拍照录入资产
          </Text>
          <Pressable
            onPress={requestPermission}
            style={{
              paddingHorizontal: 18,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: colors.green,
            }}>
            <Text style={{ color: 'white', fontWeight: '700' }}>允许相机</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <Stack.Screen options={{ headerShown: false }} />
      {active ? (
        <CameraView
          ref={camera}
          facing="back"
          mode="picture"
          onCameraReady={() => setReady(true)}
          style={{ flex: 1 }}
        />
      ) : null}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 44,
          alignItems: 'center',
          gap: 14,
        }}>
        {error ? (
          <Text
            selectable
            style={{
              color: 'white',
              backgroundColor: 'rgba(0,0,0,0.65)',
              padding: 10,
              borderRadius: 10,
              overflow: 'hidden',
            }}>
            {error}
          </Text>
        ) : (
          <Text selectable style={{ color: 'white' }}>
            每次只拍一件物品
          </Text>
        )}
        <Pressable
          accessibilityLabel="拍照"
          accessibilityRole="button"
          disabled={loading || !ready}
          onPress={takePhoto}
          style={({ pressed }) => ({
            width: 76,
            height: 76,
            borderRadius: 99,
            borderWidth: 6,
            borderColor: 'rgba(255,255,255,0.55)',
            backgroundColor: 'white',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || loading ? 0.65 : 1,
          })}>
          {loading ? <ActivityIndicator color={colors.green} /> : null}
        </Pressable>
      </View>
    </View>
  );
}
