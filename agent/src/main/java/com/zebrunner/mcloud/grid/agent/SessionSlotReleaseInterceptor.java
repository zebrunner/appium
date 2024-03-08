package com.zebrunner.mcloud.grid.agent;

import com.zebrunner.mcloud.grid.agent.stf.entity.Path;
import com.zebrunner.mcloud.grid.agent.util.HttpClient;
import net.bytebuddy.implementation.bind.annotation.RuntimeType;
import net.bytebuddy.implementation.bind.annotation.SuperCall;
import net.bytebuddy.implementation.bind.annotation.This;
import org.apache.commons.lang3.StringUtils;
import org.openqa.selenium.grid.node.local.SessionSlot;

import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;

public class SessionSlotReleaseInterceptor {
    private static final Logger LOGGER = Logger.getLogger(SessionSlotReleaseInterceptor.class.getName());
    private static final String STF_URL = System.getenv("STF_URL");
    private static final String DEFAULT_STF_TOKEN = System.getenv("STF_TOKEN");
    private static final boolean STF_ENABLED = (!StringUtils.isEmpty(STF_URL) && !StringUtils.isEmpty(DEFAULT_STF_TOKEN));
    private static final String UDID = System.getenv("DEVICE_UDID");
    static final AtomicReference<Boolean> DISCONNECT = new AtomicReference<>(true);

    @RuntimeType
    public static void onTestMethodInvocation(@This final SessionSlot slot, @SuperCall final Runnable proxy) throws Exception {
        if (STF_ENABLED) {
            try {
                if (DISCONNECT.getAndSet(true)) {
                    LOGGER.info(() -> "[STF] Return STF Device.");
                    if (HttpClient.uri(Path.STF_USER_DEVICES_BY_ID_PATH, STF_URL, UDID)
                            .withAuthorization(buildAuthToken(DEFAULT_STF_TOKEN))
                            .delete(Void.class).getStatus() != 200) {
                        LOGGER.warning(() -> "[STF] Could not return device to the STF.");
                    }
                }
            } catch (Exception e) {
                LOGGER.warning(() -> String.format("[STF] Could not return device to the STF. Error: %s", e.getMessage()));
            }
        }
        proxy.run();
    }

    private static String buildAuthToken(String authToken) {
        return "Bearer " + authToken;
    }
}
