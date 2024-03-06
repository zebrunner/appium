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
    private static final String TEST_METHOD_NAME = "test";

    public static void premain(String args, Instrumentation instrumentation) {
        try {
            new AgentBuilder.Default()
                    .with(new AgentBuilder.InitializationStrategy.SelfInjection.Eager())
                    .type(named(RELAY_SESSION_FACTORY_CLASS))
                    .transform((builder, type, classloader, module, protectionDomain) -> addTestMethodInterceptor(builder))
                    .installOn(instrumentation);
        } catch (Exception e) {
            LOGGER.warning(() -> "Could not init instrumentation.");
        }
    }

    private static DynamicType.Builder<?> addTestMethodInterceptor(DynamicType.Builder<?> builder) {
        return builder.method(isTestMethod())
                .intercept(to(testMethodInterceptor()));
    }

    public static ElementMatcher<? super MethodDescription> isTestMethod() {
        return isPublic()
                .and(not(isStatic()))
                .and(new NameMatcher<>(TEST_METHOD_NAME::equals));
    }

    private static TypeDescription testMethodInterceptor() {
        return TypePool.Default.ofSystemLoader()
                .describe(RelaySessionFactoryInterceptor.class.getName())
                .resolve();
    }
}
