/**
 * 内置网页查看页面
 * 用于显示用户协议、隐私政策等网页内容
 */

import React, { useState, useRef } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    StatusBar,
    ActivityIndicator,
} from 'react-native';
import { Text } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WebView } from 'react-native-webview';

import type { RootStackParamList } from '../types';

type WebViewScreenRouteProp = RouteProp<RootStackParamList, 'WebView'>;

const WebViewScreen: React.FC = () => {
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const route = useRoute<WebViewScreenRouteProp>();

    const { url, title } = route.params;

    const webViewRef = useRef<WebView<unknown>>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [canGoBack, setCanGoBack] = useState(false);
    const [loadError, setLoadError] = useState(false);

    /**
     * 返回上一页
     */
    const handleBack = () => {
        if (canGoBack && webViewRef.current) {
            webViewRef.current.goBack();
        } else {
            navigation.goBack();
        }
    };

    /**
     * 关闭页面
     */
    const handleClose = () => {
        navigation.goBack();
    };

    /**
     * 刷新页面
     */
    const handleRefresh = () => {
        setLoadError(false);
        webViewRef.current?.reload();
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

            {/* 头部导航栏 */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerButton} onPress={handleBack}>
                    <Icon name="arrow-left" size={24} color="#FFFFFF" />
                </TouchableOpacity>

                <View style={styles.titleContainer}>
                    <Text style={styles.title} numberOfLines={1}>
                        {title || '网页'}
                    </Text>
                </View>

                <TouchableOpacity style={styles.headerButton} onPress={handleClose}>
                    <Icon name="close" size={24} color="#FFFFFF" />
                </TouchableOpacity>
            </View>

            {/* WebView 内容 */}
            <View style={styles.webViewContainer}>
                {loadError ? (
                    <View style={styles.errorContainer}>
                        <Icon name="web-off" size={64} color="#666666" />
                        <Text style={styles.errorText}>页面加载失败</Text>
                        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
                            <Icon name="refresh" size={20} color="#00D094" />
                            <Text style={styles.retryText}>点击重试</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <WebView<unknown>
                        ref={webViewRef}
                        source={{ uri: url }}
                        style={styles.webView}
                        onLoadStart={() => setIsLoading(true)}
                        onLoadEnd={() => setIsLoading(false)}
                        onError={() => {
                            setIsLoading(false);
                            setLoadError(true);
                        }}
                        onNavigationStateChange={(navState) => {
                            setCanGoBack(navState.canGoBack);
                        }}
                        startInLoadingState={false}
                        javaScriptEnabled={true}
                        domStorageEnabled={true}
                        allowsBackForwardNavigationGestures={true}
                    />
                )}

                {/* 加载指示器 */}
                {isLoading && !loadError && (
                    <View style={styles.loadingOverlay}>
                        <ActivityIndicator size="large" color="#00D094" />
                        <Text style={styles.loadingText}>加载中...</Text>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0D0D0D',
    },

    // 头部
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 48,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
    },
    headerButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleContainer: {
        flex: 1,
        alignItems: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },

    // WebView
    webViewContainer: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    webView: {
        flex: 1,
    },

    // 加载状态
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(13, 13, 13, 0.9)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        fontSize: 14,
        color: '#888888',
        marginTop: 12,
    },

    // 错误状态
    errorContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0D0D0D',
    },
    errorText: {
        fontSize: 16,
        color: '#888888',
        marginTop: 16,
    },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 24,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#00D094',
    },
    retryText: {
        fontSize: 14,
        color: '#00D094',
        marginLeft: 6,
    },
});

export default WebViewScreen;

