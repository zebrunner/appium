package com.zebrunner.mcloud.grid.agent;

import net.bytebuddy.implementation.bind.annotation.RuntimeType;
import net.bytebuddy.implementation.bind.annotation.SuperCall;
import net.bytebuddy.implementation.bind.annotation.This;

import java.util.concurrent.Callable;

public class RelaySessionFactoryInterceptor {

    @RuntimeType
    public static Object onTestMethodInvocation(@This final Object factory,
            @SuperCall final Callable<Object> proxy) throws Exception {
        return true;
    }
}
