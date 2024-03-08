package com.zebrunner.mcloud.grid.agent;

import net.bytebuddy.implementation.bind.annotation.Argument;
import net.bytebuddy.implementation.bind.annotation.RuntimeType;
import net.bytebuddy.implementation.bind.annotation.SuperCall;
import net.bytebuddy.implementation.bind.annotation.This;
import org.openqa.selenium.Capabilities;
import org.openqa.selenium.grid.node.relay.RelaySessionFactory;

import java.util.concurrent.Callable;

public class RelaySessionFactoryInterceptor {
    private static final MobileCapabilityMatcher CAPABILITY_MATCHER = new MobileCapabilityMatcher();

    @RuntimeType
    public static Object onTestMethodInvocation(@This final RelaySessionFactory factory,
            @SuperCall final Callable<Object> proxy, @Argument(0) Capabilities capabilities) throws Exception {
        return CAPABILITY_MATCHER.matches(factory.getStereotype(), capabilities);
    }

}
