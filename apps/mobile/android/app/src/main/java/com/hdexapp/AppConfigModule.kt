package com.hdexapp

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

/**
 * Native Module 用于向 React Native 暴露渠道配置信息
 */
class AppConfigModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppConfig"

    /**
     * 获取渠道类型的常量，React Native 可以通过 NativeModules.AppConfig.CHANNEL_TYPE 访问
     */
    override fun getConstants(): Map<String, Any> {
        return mapOf(
            "CHANNEL_TYPE" to BuildConfig.CHANNEL_TYPE,
            "APPLICATION_ID" to BuildConfig.APPLICATION_ID,
            "BUILD_TYPE" to BuildConfig.BUILD_TYPE,
            "DEBUG" to BuildConfig.DEBUG,
            "VERSION_CODE" to BuildConfig.VERSION_CODE,
            "VERSION_NAME" to BuildConfig.VERSION_NAME
        )
    }

    /**
     * 同步方法获取渠道类型
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getChannelType(): String {
        return BuildConfig.CHANNEL_TYPE
    }

    /**
     * 异步方法获取渠道类型
     */
    @ReactMethod
    fun getChannelTypeAsync(promise: Promise) {
        promise.resolve(BuildConfig.CHANNEL_TYPE)
    }

    /**
     * 检查是否为 Debug 构建
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isDebugBuild(): Boolean {
        return BuildConfig.DEBUG
    }
}

