export function wishAchievementSaveErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.toLowerCase().includes('permission')
  ) {
    return '需要相册权限才能保存，请在设置中开启';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '保存失败，请重试';
}
