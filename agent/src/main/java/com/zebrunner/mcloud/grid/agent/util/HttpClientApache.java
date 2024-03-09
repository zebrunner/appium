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
package com.zebrunner.mcloud.grid.agent.util;

import com.zebrunner.mcloud.grid.agent.stf.entity.Path;
import org.apache.hc.client5.http.classic.methods.HttpDelete;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.classic.methods.HttpPost;
import org.apache.hc.client5.http.classic.methods.HttpPut;
import org.apache.hc.client5.http.classic.methods.HttpUriRequest;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse;
import org.apache.hc.client5.http.impl.classic.HttpClientBuilder;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.http.ParseException;
import org.apache.hc.core5.http.io.entity.EntityUtils;
import org.apache.hc.core5.util.Timeout;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class HttpClientApache {

    private static final Logger LOGGER = Logger.getLogger(HttpClientApache.class.getName());
    private static final RequestConfig DEFAULT_REQUEST_CFG = RequestConfig.custom()
            .setConnectionRequestTimeout(Timeout.of(Duration.ofSeconds(3)))
            .build();
    private RequestConfig requestConfig = DEFAULT_REQUEST_CFG;
    private String url;

    private HttpClientApache() {
        //hide
    }

    public static HttpClientApache create() {
        return new HttpClientApache();
    }

    public HttpClientApache withRequestConfig(RequestConfig requestConfig) {
        this.requestConfig = requestConfig;
        return this;
    }

    public HttpClientApache withUri(Path path, String serviceUrl, Object... parameters) {
        this.url = path.build(serviceUrl, parameters);
        return this;
    }

    public HttpClient.Response<String> get() {
        if (url == null) {
            LOGGER.log(Level.WARNING, "url should be specified!");
            return null;
        }
        return execute(new HttpGet(url));
    }

    public static class HttpGetWithEntity extends HttpUriRequestBase {
        public static final String METHOD_NAME = "GET";

        public HttpGetWithEntity(final String uri) {
            super(METHOD_NAME, URI.create(uri));
        }

        @Override
        public String getMethod() {
            return METHOD_NAME;
        }
    }

    public HttpClient.Response<String> get(HttpEntity entity) {
        if (url == null) {
            LOGGER.log(Level.WARNING, "url should be specified!");
            return null;
        }
        HttpGetWithEntity get = new HttpGetWithEntity(url);
        get.setEntity(entity);
        return execute(get);
    }

    public HttpClient.Response<String> post(HttpEntity entity) {
        if (url == null) {
            LOGGER.log(Level.WARNING, "url should be specified!");
            return null;
        }
        HttpPost post = new HttpPost(url);
        post.setEntity(entity);
        return execute(post);
    }

    public HttpClient.Response<String> put(HttpEntity entity) {
        if (url == null) {
            LOGGER.log(Level.WARNING, "url should be specified!");
            return null;
        }
        HttpPut put = new HttpPut(url);
        put.setEntity(entity);
        return execute(put);
    }

    public HttpClient.Response<String> delete() {
        if (url == null) {
            LOGGER.log(Level.WARNING, "url should be specified!");
            return null;
        }
        HttpDelete delete = new HttpDelete(url);
        return execute(delete);
    }

    private HttpClient.Response<String> execute(HttpUriRequest req) {
        HttpClient.Response<String> result = new HttpClient.Response<>();
        try (CloseableHttpClient httpClient = HttpClientBuilder.create()
                .setDefaultRequestConfig(requestConfig)
                .build();
                CloseableHttpResponse response = httpClient.execute(req)) {
            result.setStatus(response.getCode());
            result.setObject(EntityUtils.toString(response.getEntity()));
        } catch (IOException | ParseException e) {
            LOGGER.log(Level.SEVERE, e.getMessage(), e);
        }
        return result;
    }
}
