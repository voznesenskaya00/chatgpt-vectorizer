export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    // ==========================================
    // 1. Получаем исходное изображение
    // ==========================================

    let imageUrl = null;

    if (
      Array.isArray(body.openaiFileIdRefs) &&
      body.openaiFileIdRefs.length > 0
    ) {
      const file = body.openaiFileIdRefs[0];

      imageUrl =
        file.download_link ||
        file.downloadLink ||
        file.url ||
        null;
    }

    if (!imageUrl && typeof body.image_url === "string") {
      imageUrl = body.image_url;
    }

    if (!imageUrl) {
      return res.status(400).json({
        error: "Не найдено изображение",
        details: "ChatGPT не передал изображение."
      });
    }

    // ==========================================
    // 2. API KEY
    // ==========================================

    const apiKey = process.env.GENAPI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Не настроен GENAPI_API_KEY в Vercel."
      });
    }

    // ==========================================
    // 3. СНАЧАЛА УЛУЧШАЕМ ИСХОДНИК
    // ==========================================

    const upscaleResponse = await fetch(
      "https://api.gen-api.ru/api/v1/networks/recraft-upscaler",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },

        body: JSON.stringify({
          is_sync: false,

          image_url: imageUrl,

          model: "crisp-upscale",

          enable_safety_checker: false
        })
      }
    );

    const upscaleData = await upscaleResponse.json();

    if (!upscaleResponse.ok) {
      return res.status(upscaleResponse.status).json({
        error: "Ошибка Recraft Crisp Upscale",
        details: upscaleData
      });
    }

    const upscaleRequestId = upscaleData.request_id;

    if (!upscaleRequestId) {
      return res.status(500).json({
        error: "Recraft Upscale не вернул request_id",
        details: upscaleData
      });
    }

    // ==========================================
    // 4. Ждём улучшенное изображение
    // ==========================================

    let upscaleResult = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve =>
        setTimeout(resolve, 3000)
      );

      const response = await fetch(
        `https://api.gen-api.ru/api/v1/request/get/${upscaleRequestId}`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          }
        }
      );

      upscaleResult = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Ошибка получения результата Upscale",
          details: upscaleResult
        });
      }

      if (upscaleResult.status === "success") {
        break;
      }

      if (
        upscaleResult.status === "failed" ||
        upscaleResult.status === "error"
      ) {
        return res.status(500).json({
          error: "Upscale завершился ошибкой",
          details: upscaleResult
        });
      }
    }

    if (
      !upscaleResult ||
      upscaleResult.status !== "success"
    ) {
      return res.status(202).json({
        success: false,
        processing: true,
        message: "Улучшение изображения ещё выполняется.",
        request_id: upscaleRequestId
      });
    }

    // ==========================================
    // 5. Получаем URL улучшенного изображения
    // ==========================================

    let enhancedImageUrl = null;

    const output = upscaleResult.result || upscaleResult.output;

    if (typeof output === "string") {
      enhancedImageUrl = output;
    }

    if (Array.isArray(output) && output.length > 0) {
      enhancedImageUrl = output[0];
    }

    if (
      output &&
      typeof output === "object"
    ) {
      enhancedImageUrl =
        output.url ||
        output.image_url ||
        output.image ||
        null;
    }

    if (!enhancedImageUrl) {
      return res.status(500).json({
        error: "Не удалось получить URL улучшенного изображения.",
        details: upscaleResult
      });
    }

    // ==========================================
    // 6. ТЕПЕРЬ ВЕКТОРИЗУЕМ УЛУЧШЕННЫЙ ИСХОДНИК
    // ==========================================

    const vectorResponse = await fetch(
      "https://api.gen-api.ru/api/v1/networks/image-2-svg",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },

        body: JSON.stringify({
          is_sync: false,

          image_url: enhancedImageUrl,

          colormode: "color",
          hierarchical: "stacked",
          mode: "spline",

          // Максимально сохраняем мелкие детали
          filter_speckle: 1,

          // Сохраняем больше цветовых оттенков
          color_precision: 8,

          // Меньше объединяем близкие цветовые слои
          layer_difference: 8,

          // Более аккуратные контуры
          corner_threshold: 45,

          length_threshold: 3,

          max_iterations: 20,

          splice_threshold: 30,

          // Более точные координаты SVG
          path_precision: 6
        })
      }
    );

    const vectorData = await vectorResponse.json();

    if (!vectorResponse.ok) {
      return res.status(vectorResponse.status).json({
        error: "Ошибка GenAPI Image2SVG",
        details: vectorData
      });
    }

    const vectorRequestId = vectorData.request_id;

    if (!vectorRequestId) {
      return res.status(500).json({
        error: "Image2SVG не вернул request_id",
        details: vectorData
      });
    }

    // ==========================================
    // 7. Ждём SVG
    // ==========================================

    let svgResult = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve =>
        setTimeout(resolve, 3000)
      );

      const response = await fetch(
        `https://api.gen-api.ru/api/v1/request/get/${vectorRequestId}`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          }
        }
      );

      svgResult = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Ошибка получения SVG",
          details: svgResult
        });
      }

      if (svgResult.status === "success") {
        break;
      }

      if (
        svgResult.status === "failed" ||
        svgResult.status === "error"
      ) {
        return res.status(500).json({
          error: "Векторизация завершилась ошибкой",
          details: svgResult
        });
      }
    }

    if (
      !svgResult ||
      svgResult.status !== "success"
    ) {
      return res.status(202).json({
        success: false,
        processing: true,
        message: "Векторизация ещё выполняется.",
        request_id: vectorRequestId
      });
    }

    const result = svgResult.result;

    if (Array.isArray(result) && result.length > 0) {
      return res.status(200).json({
        success: true,
        message: "Изображение успешно улучшено и векторизовано.",
        request_id: vectorRequestId,
        status: "success",
        svg_url: result[0],
        result: result
      });
    }

    if (typeof result === "string") {
      return res.status(200).json({
        success: true,
        message: "Изображение успешно улучшено и векторизовано.",
        request_id: vectorRequestId,
        status: "success",
        svg_url: result,
        result: [result]
      });
    }

    return res.status(500).json({
      error: "GenAPI не вернул ссылку на SVG.",
      details: svgResult
    });

  } catch (error) {
    return res.status(500).json({
      error: "Ошибка сервера",
      details: error.message
    });
  }
}
