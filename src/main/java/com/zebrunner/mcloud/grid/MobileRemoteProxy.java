/*******************************************************************************
 * Copyright 2018-2021 Zebrunner (https://zebrunner.com/).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *******************************************************************************/
package com.zebrunner.mcloud.grid;

import org.openqa.selenium.Capabilities;
import org.openqa.selenium.NoSuchSessionException;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.grid.config.Config;
import org.openqa.selenium.grid.data.CreateSessionRequest;
import org.openqa.selenium.grid.data.CreateSessionResponse;
import org.openqa.selenium.grid.data.NodeId;
import org.openqa.selenium.grid.data.NodeStatus;
import org.openqa.selenium.grid.data.Session;
import org.openqa.selenium.grid.log.LoggingOptions;
import org.openqa.selenium.grid.node.HealthCheck;
import org.openqa.selenium.grid.node.Node;
import org.openqa.selenium.grid.node.local.LocalNode;
import org.openqa.selenium.grid.node.local.LocalNodeFactory;
import org.openqa.selenium.grid.security.Secret;
import org.openqa.selenium.grid.security.SecretOptions;
import org.openqa.selenium.grid.server.BaseServerOptions;
import org.openqa.selenium.internal.Either;
import org.openqa.selenium.io.TemporaryFilesystem;
import org.openqa.selenium.remote.SessionId;
import org.openqa.selenium.remote.http.HttpRequest;
import org.openqa.selenium.remote.http.HttpResponse;
import org.openqa.selenium.remote.tracing.Tracer;

import java.io.IOException;
import java.net.URI;
import java.util.UUID;

public class MobileRemoteProxy extends Node {
    private LocalNode node;

    protected MobileRemoteProxy(Tracer tracer, URI uri, Secret registrationSecret) {
        super(tracer, new NodeId(UUID.randomUUID()), uri, registrationSecret);
    }

    @SuppressWarnings("unchecked")
    public static Node create(Config config) {
        LoggingOptions loggingOptions = new LoggingOptions(config);
        BaseServerOptions serverOptions = new BaseServerOptions(config);
        URI uri = serverOptions.getExternalUri();
        SecretOptions secretOptions = new SecretOptions(config);

        // Refer to the foot notes for additional context on this line.
        Node node = LocalNodeFactory.create(config);

        MobileRemoteProxy wrapper = new MobileRemoteProxy(loggingOptions.getTracer(), uri, secretOptions.getRegistrationSecret());
        wrapper.node = (LocalNode) node;
        return wrapper;
    }

    @Override
    public Either<WebDriverException, CreateSessionResponse> newSession(CreateSessionRequest sessionRequest) {
        return node.newSession(sessionRequest);
    }

    @Override
    public HttpResponse executeWebDriverCommand(HttpRequest req) {
        return node.executeWebDriverCommand(req);
    }

    @Override
    public Session getSession(SessionId id) throws NoSuchSessionException {
        return node.getSession(id);
    }

    @Override
    public HttpResponse uploadFile(HttpRequest req, SessionId id) {
        return node.uploadFile(req, id);
    }

    @Override
    public HttpResponse downloadFile(HttpRequest req, SessionId id) {
        return node.downloadFile(req, id);
    }

    @Override
    public TemporaryFilesystem getDownloadsFilesystem(UUID uuid) throws IOException {
        return node.getDownloadsFilesystem(uuid);
    }

    @Override
    public TemporaryFilesystem getUploadsFilesystem(SessionId id) throws IOException {
        return node.getUploadsFilesystem(id);
    }

    @Override
    public void stop(SessionId id) throws NoSuchSessionException {
        node.stop(id);
    }

    @Override
    public boolean isSessionOwner(SessionId id) {
        return node.isSessionOwner(id);
    }

    @Override
    public boolean isSupporting(Capabilities capabilities) {
        return node.isSupporting(capabilities);
    }

    @Override
    public NodeStatus getStatus() {
        return node.getStatus();
    }

    @Override
    public HealthCheck getHealthCheck() {
        return node.getHealthCheck();
    }

    @Override
    public void drain() {
        node.drain();
    }

    @Override
    public boolean isReady() {
        return node.isReady();
    }

}
