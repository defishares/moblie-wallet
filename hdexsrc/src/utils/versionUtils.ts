/**
 * 版本更新相关工具函数
 */

import { Alert, Linking } from 'react-native';
import type { VersionCheckResult } from '../types';

/**
 * 打开下载链接
 */
export const openDownloadUrl = async (url: string): Promise<boolean> => {
    try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
            await Linking.openURL(url);
            return true;
        } else {
            Alert.alert('错误', '无法打开下载链接');
            return false;
        }
    } catch (error) {
        console.error('[VersionUtils] 打开下载链接失败:', error);
        Alert.alert('错误', '打开下载链接失败');
        return false;
    }
};

/**
 * 显示版本更新弹框
 * @param result 版本检测结果
 * @param onDismiss 弹框关闭回调（用户选择"以后更新"时调用）
 */
export const showVersionUpdateAlert = (
    result: VersionCheckResult,
    onDismiss?: () => void
): void => {
    const { isForceUpdate, latestVersion, downloadUrl, updateInfo } = result;

    if (isForceUpdate) {
        // 强制更新 - 不可取消
        Alert.alert(
            '发现新版本',
            `${updateInfo}\n\n最新版本: v${latestVersion}`,
            [
                {
                    text: '立即更新',
                    onPress: () => openDownloadUrl(downloadUrl),
                },
            ],
            { cancelable: false }
        );
    } else {
        // 非强制更新 - 可选择以后更新
        Alert.alert(
            '发现新版本',
            `${updateInfo}\n\n最新版本: v${latestVersion}`,
            [
                {
                    text: '以后更新',
                    style: 'cancel',
                    onPress: onDismiss,
                },
                {
                    text: '立即更新',
                    onPress: () => openDownloadUrl(downloadUrl),
                },
            ]
        );
    }
};

