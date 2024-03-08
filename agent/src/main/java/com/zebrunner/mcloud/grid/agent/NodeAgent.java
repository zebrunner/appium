package com.zebrunner.mcloud.grid.agent;

import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.description.method.MethodDescription;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.dynamic.DynamicType;
import net.bytebuddy.matcher.ElementMatcher;
import net.bytebuddy.matcher.NameMatcher;
import net.bytebuddy.pool.TypePool;

import java.lang.instrument.Instrumentation;
import java.util.logging.Logger;

import static net.bytebuddy.implementation.MethodDelegation.to;
import static net.bytebuddy.matcher.ElementMatchers.isPublic;
import static net.bytebuddy.matcher.ElementMatchers.isStatic;
import static net.bytebuddy.matcher.ElementMatchers.named;
import static net.bytebuddy.matcher.ElementMatchers.not;

public class NodeAgent {
    private static final Logger LOGGER = Logger.getLogger(NodeAgent.class.getName());
    private static final String RELAY_SESSION_FACTORY_CLASS = "org.openqa.selenium.grid.node.relay.RelaySessionFactory";
    private static final String SESSION_SLOT_CLASS = "org.openqa.selenium.grid.node.local.SessionSlot";

    public static void premain(String args, Instrumentation instrumentation) {
        try {
            new AgentBuilder.Default()
                    .with(new AgentBuilder.InitializationStrategy.SelfInjection.Eager())
                    .type(named(RELAY_SESSION_FACTORY_CLASS))
                    .transform((builder, type, classloader, module, protectionDomain) -> addTestMethodInterceptor(builder))
                    .type(named(SESSION_SLOT_CLASS))
                    .transform((builder, type, classloader, module, protectionDomain) -> addSessionSlotMethodInterceptor(builder))
                    .installOn(instrumentation);
        } catch (Exception e) {
            LOGGER.warning(() -> "Could not init instrumentation.");
        }
    }

    private static DynamicType.Builder<?> addTestMethodInterceptor(DynamicType.Builder<?> builder) {
        return builder.method(isTestMethod())
                .intercept(to(testMethodInterceptor()));
    }

    private static DynamicType.Builder<?> addSessionSlotMethodInterceptor(DynamicType.Builder<?> builder) {
        return builder.method(isReleaseMethod())
                .intercept(to(releaseMethodInterceptor()))
                .method(isReserveMethod())
                .intercept(to(reserveMethodInterceptor()));
    }

    public static ElementMatcher<? super MethodDescription> isTestMethod() {
        return isPublic()
                .and(not(isStatic()))
                .and(new NameMatcher<>("test"::equals));
    }

    private static TypeDescription testMethodInterceptor() {
        return TypePool.Default.ofSystemLoader()
                .describe(RelaySessionFactoryInterceptor.class.getName())
                .resolve();
    }

    public static ElementMatcher<? super MethodDescription> isReleaseMethod() {
        return isPublic()
                .and(not(isStatic()))
                .and(new NameMatcher<>("release"::equals));
    }

    private static TypeDescription releaseMethodInterceptor() {
        return TypePool.Default.ofSystemLoader()
                .describe(SessionSlotReleaseInterceptor.class.getName())
                .resolve();
    }

    public static ElementMatcher<? super MethodDescription> isReserveMethod() {
        return isPublic()
                .and(not(isStatic()))
                .and(new NameMatcher<>("reserve"::equals));
    }

    private static TypeDescription reserveMethodInterceptor() {
        return TypePool.Default.ofSystemLoader()
                .describe(SessionSlotReserveInterceptor.class.getName())
                .resolve();
    }
}
